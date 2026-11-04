/**
 * Host half of @local/dsh-disk-usage.
 *
 * Registers two exact Fetch routes inside Connection's authentication fence
 * (only owner Peers reach them):
 *   GET  /api/disk-usage/scan  -> full footprint report (categories + file types + suggestions)
 *   POST /api/disk-usage/clean -> execute whitelisted cleanup targets (no arbitrary paths)
 */
import { readdir, lstat, rm, truncate } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';

export const inject = ['connection'];

const SCAN_PATH = '/api/disk-usage/scan';
const CLEAN_PATH = '/api/disk-usage/clean';

/** Resolve the DSH installation root (the directory holding dsh-data, dsh-runtime, ...). */
function resolveBase() {
	const dataHome = process.env.DSH_HOME
		?? (process.env.DSH_PROFILE_DIR ? dirname(dirname(process.env.DSH_PROFILE_DIR)) : undefined);
	return dataHome ? dirname(dataHome) : undefined;
}

const isErrno = (error, code) => error && typeof error === 'object' && error.code === code;

/**
 * Walk one directory tree and aggregate byte sizes.
 * Prunes absolute paths listed in `skip`. Extension statistics accumulate into `extStats`.
 */
async function walkTree(root, { skip = [], extStats = null, errors = null } = {}) {
	const skipSet = new Set(skip);
	const state = { bytes: 0, files: 0, dirs: 0 };
	const queue = [root];
	while (queue.length > 0) {
		const batch = queue.splice(0, 96);
		const results = await Promise.all(batch.map(async (dir) => {
			let entries;
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch (error) {
				if (errors && !isErrno(error, 'ENOENT')) errors.push(`${dir}: ${error.message}`);
				return;
			}
			await Promise.all(entries.map(async (entry) => {
				const full = join(dir, entry.name);
				try {
					if (entry.isDirectory()) {
						if (skipSet.has(full)) return;
						state.dirs += 1;
						queue.push(full);
					} else if (entry.isFile()) {
						const info = await lstat(full);
						state.bytes += info.size;
						state.files += 1;
						if (extStats) {
							const name = entry.name;
							const dot = name.lastIndexOf('.');
							let ext = '';
							if (dot > 0 && dot >= name.length - 13) ext = name.slice(dot + 1).toLowerCase();
							const bucket = extStats.get(ext) ?? { bytes: 0, files: 0 };
							bucket.bytes += info.size;
							bucket.files += 1;
							extStats.set(ext, bucket);
						}
					}
				} catch (error) {
					if (errors && !isErrno(error, 'ENOENT')) errors.push(`${full}: ${error.message}`);
				}
			}));
		}));
		void results;
	}
	return state;
}

/** Size of one path (file or tree), without extension stats. */
async function pathSize(target, errors = []) {
	try {
		const info = await lstat(target);
		if (!info.isDirectory()) return { bytes: info.size, files: 1 };
	} catch (error) {
		if (!isErrno(error, 'ENOENT')) errors.push(`${target}: ${error.message}`);
		return { bytes: 0, files: 0 };
	}
	return walkTree(target, { errors });
}

/** Remove every entry inside a directory, keeping the directory itself. */
async function clearDirContents(dir, errors) {
	let entries = [];
	try {
		entries = await readdir(dir);
	} catch (error) {
		if (!isErrno(error, 'ENOENT')) errors.push(`${dir}: ${error.message}`);
		return 0;
	}
	let freed = 0;
	for (const name of entries) {
		const target = join(dir, name);
		freed += (await pathSize(target, errors)).bytes;
		await rm(target, { recursive: true, force: true }).catch((error) => errors.push(`${target}: ${error.message}`));
	}
	return freed;
}

/** Find venv-style rebuildable Python environments directly under workspaces. */
async function findVenvs(homeDir, errors) {
	const found = [];
	let entries = [];
	try {
		entries = await readdir(homeDir, { withFileTypes: true });
	} catch (error) {
		if (!isErrno(error, 'ENOENT')) errors.push(`${homeDir}: ${error.message}`);
		return found;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name === 'node_modules') continue;
		const candidate = join(homeDir, entry.name, 'venv');
		try {
			const info = await lstat(candidate);
			if (info.isDirectory()) found.push(candidate);
		} catch {
			/* absent is normal */
		}
	}
	return found;
}

/** List upgrade snapshot directories, newest first (timestamp encoded in the name). */
async function listSnapshots(snapDir, errors) {
	let entries = [];
	try {
		entries = await readdir(snapDir, { withFileTypes: true });
	} catch (error) {
		if (!isErrno(error, 'ENOENT')) errors.push(`${snapDir}: ${error.message}`);
		return [];
	}
	return entries
		.filter((entry) => entry.isDirectory() && entry.name.startsWith('snap_'))
		.map((entry) => entry.name)
		.sort()
		.reverse();
}

/** Depth-limited search for `*.bak*` files outside node_modules and snapshots. */
async function findBakFiles(base, errors) {
	const found = [];
	const prune = new Set(['node_modules', 'snapshots', '.git', 'dsh-runtime', 'browser-ops']);
	const visit = async (dir, depth) => {
		if (depth > 4 || found.length > 200) return;
		let entries = [];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (error) {
			if (!isErrno(error, 'ENOENT')) errors.push(`${dir}: ${error.message}`);
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!prune.has(entry.name)) await visit(full, depth + 1);
			} else if (entry.isFile() && /\.bak($|[-.])/.test(entry.name)) {
				found.push(full);
			}
		}
	};
	await visit(base, 0);
	return found;
}

/** Category and cleanup-target definitions, relative to the installation root. */
function categoryPlan(base) {
	const at = (...parts) => parts.reduce((acc, part) => join(acc, part), base);
	return {
		categories: [
			{ id: 'runtime', path: at('dsh-runtime'), clean: null },
			{ id: 'snapshots', path: at('snapshots'), clean: 'snapshots-old' },
			{ id: 'npm-cache', path: at('npm-cache'), clean: 'npm-cache' },
			{ id: 'pnpm', path: at('pnpm-home'), clean: 'pnpm-store' },
			{ id: 'browsers', path: at('dsh-data', 'browser-ops', 'browsers'), clean: 'browsers' },
			{ id: 'sessions', path: at('dsh-data', 'sessions'), clean: null },
			{ id: 'skills', path: at('dsh-data', 'skills'), clean: null },
			{ id: 'attachments', path: at('dsh-data', 'attachments'), clean: null },
			{ id: 'profiles', path: at('dsh-data', 'profiles'), clean: null },
			{ id: 'home', path: at('home'), clean: null },
			{ id: 'venv', path: null, clean: 'venv' },
			{ id: 'superagent', path: at('dsh-superagent'), clean: null },
			{ id: 'logs', path: null, clean: 'logs' },
			{ id: 'other', path: null, clean: null }
		]
	};
}

/** Compute suggestion sizes for the cleanup whitelist. */
async function computeSuggestions(base, venvs, snapshotNames, errors) {
	const at = (...parts) => parts.reduce((acc, part) => join(acc, part), base);
	const [cacache, npx, logsNpm, pnpmStore, browsers] = await Promise.all([
		pathSize(at('npm-cache', '_cacache'), errors),
		pathSize(at('npm-cache', '_npx'), errors),
		pathSize(at('npm-cache', '_logs'), errors),
		pathSize(at('pnpm-home', 'store'), errors),
		pathSize(at('dsh-data', 'browser-ops', 'browsers'), errors)
	]);
	let venvBytes = 0;
	for (const dir of venvs) venvBytes += (await pathSize(dir, errors)).bytes;
	let snapshotsOldBytes = 0;
	for (const name of snapshotNames.slice(1)) snapshotsOldBytes += (await pathSize(at('snapshots', name), errors)).bytes;
	let logsBytes = 0;
	for (const file of ['harness.log', 'info.log']) logsBytes += (await pathSize(at(file), errors)).bytes;
	logsBytes += (await pathSize(at('logs'), errors)).bytes;
	const bakFiles = await findBakFiles(base, errors);
	let bakBytes = 0;
	for (const file of bakFiles) bakBytes += (await pathSize(file, errors)).bytes;
	return {
		'npm-cache': { bytes: cacache.bytes + npx.bytes + logsNpm.bytes, level: 'safe', count: 3 },
		'pnpm-store': { bytes: pnpmStore.bytes, level: 'safe', count: 1 },
		browsers: { bytes: browsers.bytes, level: 'safe', count: 1 },
		'snapshots-old': { bytes: snapshotsOldBytes, level: 'caution', count: Math.max(0, snapshotNames.length - 1) },
		logs: { bytes: logsBytes, level: 'safe', count: 1 },
		'bak-files': { bytes: bakBytes, level: 'safe', count: bakFiles.length },
		venv: { bytes: venvBytes, level: 'caution', count: venvs.length }
	};
}

/**
 * Execute one whitelisted cleanup target. Every path handled here is derived
 * from `base` on the server side; the request never carries a filesystem path.
 */
async function cleanTarget(id, base, plan, errors) {
	const at = (...parts) => parts.reduce((acc, part) => join(acc, part), base);
	let freed = 0;
	switch (id) {
		case 'npm-cache':
			for (const sub of ['_cacache', '_npx', '_logs']) freed += await clearDirContents(at('npm-cache', sub), errors);
			return freed;
		case 'pnpm-store':
			freed += await clearDirContents(at('pnpm-home', 'store'), errors);
			return freed;
		case 'browsers':
			freed += await clearDirContents(at('dsh-data', 'browser-ops', 'browsers'), errors);
			return freed;
		case 'snapshots-old': {
			const names = await listSnapshots(at('snapshots'), errors);
			for (const name of names.slice(1)) {
				const target = at('snapshots', name);
				freed += (await pathSize(target, errors)).bytes;
				await rm(target, { recursive: true, force: true }).catch((error) => errors.push(`${target}: ${error.message}`));
			}
			return freed;
		}
		case 'logs':
			for (const file of ['harness.log', 'info.log']) {
				const target = at(file);
				try {
					const info = await lstat(target);
					if (info.isFile()) {
						freed += info.size;
						await truncate(target, 0);
					}
				} catch {
					/* absent is fine */
				}
			}
			freed += await clearDirContents(at('logs'), errors);
			return freed;
		case 'bak-files': {
			const files = await findBakFiles(base, errors);
			for (const file of files) {
				try {
					const info = await lstat(file);
					freed += info.size;
					await rm(file, { force: true });
				} catch (error) {
					errors.push(`${file}: ${error.message}`);
				}
			}
			return freed;
		}
		case 'venv': {
			const venvs = await findVenvs(at('home'), errors);
			for (const dir of venvs) {
				freed += (await pathSize(dir, errors)).bytes;
				await rm(dir, { recursive: true, force: true }).catch((error) => errors.push(`${dir}: ${error.message}`));
			}
			return freed;
		}
		default:
			throw new Error(`unknown cleanup target: ${id}`);
	}
}

const CLEAN_TARGETS = new Set(['npm-cache', 'pnpm-store', 'browsers', 'snapshots-old', 'logs', 'bak-files', 'venv']);

/** Build the full footprint report. */
async function scanReport(base) {
	const errors = [];
	const plan = categoryPlan(base);
	const extStats = new Map();
	const at = (...parts) => parts.reduce((acc, part) => join(acc, part), base);

	const venvs = await findVenvs(at('home'), errors);
	const snapshotNames = await listSnapshots(at('snapshots'), errors);

	const homeSkip = venvs.slice();
	const dataKnown = new Set(['browser-ops', 'sessions', 'skills', 'attachments', 'profiles'].map((name) => at('dsh-data', name)));

	const walkCategory = async (category) => {
		if (category.id === 'venv') {
			let bytes = 0;
			let files = 0;
			for (const dir of venvs) {
				const state = await walkTree(dir, { extStats, errors });
				bytes += state.bytes;
				files += state.files;
			}
			return { ...category, bytes, files, paths: venvs };
		}
		if (category.id === 'logs') {
			let bytes = 0;
			let files = 0;
			for (const file of ['harness.log', 'info.log']) {
				try {
					const info = await lstat(at(file));
					if (info.isFile()) {
						bytes += info.size;
						files += 1;
						const name = basename(file);
						const bucket = extStats.get('.log') ?? { bytes: 0, files: 0 };
						bucket.bytes += info.size;
						bucket.files += 1;
						extStats.set('.log', bucket);
						void name;
					}
				} catch {
					/* absent is fine */
				}
			}
			const logsDir = await walkTree(at('logs'), { extStats, errors });
			bytes += logsDir.bytes;
			files += logsDir.files;
			return { ...category, path: at('logs'), bytes, files };
		}
		if (category.id === 'other') {
			// Everything at the root not claimed by another category.
			const claimed = new Set(plan.categories.filter((entry) => entry.path).map((entry) => resolve(entry.path)));
			claimed.add(at('pnpm-env')); // counted here, small and required by pnpm runs
			let entries = [];
			try {
				entries = await readdir(base, { withFileTypes: true });
			} catch (error) {
				errors.push(`${base}: ${error.message}`);
				return { ...category, bytes: 0, files: 0 };
			}
			let bytes = 0;
			let files = 0;
			for (const entry of entries) {
				const full = join(base, entry.name);
				if (claimed.has(resolve(full))) continue;
				if (entry.isDirectory()) {
					const state = await walkTree(full, { extStats, errors });
					bytes += state.bytes;
					files += state.files;
				} else if (entry.isFile()) {
					const info = await lstat(full);
					bytes += info.size;
					files += 1;
				}
			}
			return { ...category, bytes, files };
		}
		if (category.id === 'home') {
			const state = await walkTree(category.path, { skip: homeSkip, extStats, errors });
			return { ...category, bytes: state.bytes, files: state.files };
		}
		if (category.id === 'sessions' || category.id === 'skills' || category.id === 'attachments' || category.id === 'profiles') {
			void dataKnown;
			const state = await walkTree(category.path, { extStats, errors });
			return { ...category, bytes: state.bytes, files: state.files };
		}
		const state = await walkTree(category.path, { extStats, errors });
		return { ...category, bytes: state.bytes, files: state.files };
	};

	const categories = [];
	for (const category of plan.categories) {
		const measured = await walkCategory(category);
		categories.push({
			id: measured.id,
			path: measured.path,
			bytes: measured.bytes,
			files: measured.files,
			clean: measured.clean
		});
	}

	// dsh-data remainder (storages, memories, caches, misc) folded into `other`.
	const dataHome = at('dsh-data');
	const dataClaimed = new Set(['browser-ops', 'sessions', 'skills', 'attachments', 'profiles'].map((name) => at('dsh-data', name)));
	let dataEntries = [];
	try {
		dataEntries = await readdir(dataHome, { withFileTypes: true });
	} catch (error) {
		if (!isErrno(error, 'ENOENT')) errors.push(`${dataHome}: ${error.message}`);
	}
	let dataRestBytes = 0;
	let dataRestFiles = 0;
	for (const entry of dataEntries) {
		const full = join(dataHome, entry.name);
		if (dataClaimed.has(resolve(full))) continue;
		if (entry.isDirectory()) {
			const state = await walkTree(full, { extStats, errors });
			dataRestBytes += state.bytes;
			dataRestFiles += state.files;
		} else if (entry.isFile()) {
			const info = await lstat(full);
			dataRestBytes += info.size;
			dataRestFiles += 1;
		}
	}
	const other = categories.find((entry) => entry.id === 'other');
	other.bytes += dataRestBytes;
	other.files += dataRestFiles;

	const totalBytes = categories.reduce((sum, entry) => sum + entry.bytes, 0);
	const totalFiles = categories.reduce((sum, entry) => sum + entry.files, 0);

	const fileTypes = [...extStats.entries()]
		.map(([ext, bucket]) => ({ ext: ext || 'none', ...bucket }))
		.sort((a, b) => b.bytes - a.bytes)
		.slice(0, 16);

	const suggestions = await computeSuggestions(base, venvs, snapshotNames, errors);

	return {
		base,
		generatedAt: new Date().toISOString(),
		totalBytes,
		totalFiles,
		categories,
		fileTypes,
		suggestions,
		snapshotCount: snapshotNames.length,
		venvCount: venvs.length,
		errors: errors.slice(0, 20)
	};
}

/** Cordis plugin entry: register the two Fetch routes. */
export function apply(ctx) {
	const base = resolveBase();
	if (!base) {
		throw new Error('dsh-disk-usage: cannot resolve the installation root (DSH_HOME/DSH_PROFILE_DIR missing)');
	}
	ctx.effect(() => {
		const disposeScan = ctx.connection.fetch.register({
			path: SCAN_PATH,
			methods: ['GET'],
			requestBody: 'buffered',
			fetch: async () => {
				try {
					const report = await scanReport(base);
					return Response.json(report, { headers: { 'cache-control': 'no-store' } });
				} catch (error) {
					return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
				}
			}
		});
		const disposeClean = ctx.connection.fetch.register({
			path: CLEAN_PATH,
			methods: ['POST'],
			requestBody: 'buffered',
			fetch: async (request) => {
				let targets = [];
				try {
					const body = await request.json();
					if (Array.isArray(body?.targets)) targets = body.targets.filter((item) => typeof item === 'string');
				} catch {
					return Response.json({ error: 'invalid JSON body' }, { status: 400 });
				}
				const results = [];
				let totalFreed = 0;
				for (const id of targets) {
					if (!CLEAN_TARGETS.has(id)) {
						results.push({ id, ok: false, freedBytes: 0, error: 'unknown target' });
						continue;
					}
					const errors = [];
					try {
						const freed = await cleanTarget(id, base, categoryPlan(base), errors);
						totalFreed += freed;
						results.push({ id, ok: errors.length === 0, freedBytes: freed, error: errors.join('; ') || undefined });
					} catch (error) {
						results.push({ id, ok: false, freedBytes: 0, error: error instanceof Error ? error.message : String(error) });
					}
				}
				return Response.json({ results, totalFreed, finishedAt: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } });
			}
		});
		return () => {
			disposeScan();
			disposeClean();
		};
	}, 'dsh-disk-usage: connection fetch routes');
}
