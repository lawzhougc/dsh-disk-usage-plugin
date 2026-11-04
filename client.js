/**
 * Client half of @local/dsh-disk-usage.
 * Registers a sidebar panel icon and the main "Disk usage" panel page.
 * Talks to the Host half through the same-origin authenticated /api channel.
 */
window.__ModuleLoader__.load({
	id: '@local/dsh-disk-usage',
	factory(require) {
		const React = require('react');
		const h = React.createElement;
		const { useState, useEffect, useMemo, useCallback } = React;

		const NS = 'disk-usage';
		const PANEL_ID = 'disk-usage';

		function formatBytes(bytes) {
			if (!Number.isFinite(bytes) || bytes < 0) return '—';
			if (bytes < 1024) return `${bytes} B`;
			const units = ['KB', 'MB', 'GB', 'TB'];
			let value = bytes;
			let unit = 'B';
			for (const next of units) {
				if (value < 1024) break;
				value /= 1024;
				unit = next;
			}
			return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
		}

		function DiskUsageIcon({ size }) {
			const s = size ?? 18;
			return h('svg', {
				viewBox: '0 0 24 24', width: s, height: s,
				'aria-hidden': true,
				style: { display: 'block' }
			},
				h('rect', { x: 2.5, y: 5, width: 19, height: 14, rx: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 }),
				h('circle', { cx: 16.8, cy: 15.2, r: 1.5, fill: 'currentColor' }),
				h('path', { d: 'M6 12h6', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
				h('path', { d: 'M6 15.2h3', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }));
		}

		const CSS = `
.ddu-root{height:100%;width:100%;box-sizing:border-box;overflow-y:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;padding:24px 28px 48px}
.ddu-inner{max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:20px}
.ddu-header{display:flex;align-items:center;gap:12px}
.ddu-title{font-size:20px;font-weight:600;flex:1;min-width:0}
.ddu-sub{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px;font-family:var(--ds-font-family-code,monospace);word-break:break-all}
.ddu-button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer;line-height:20px;flex:none}
.ddu-button:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.ddu-button:disabled{opacity:.45;cursor:default}
.ddu-buttonPrimary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted,#fff);font-weight:500}
.ddu-buttonPrimary:hover{filter:brightness(1.08);background:var(--dsw-alias-brand-primary)}
.ddu-buttonDanger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:transparent}
.ddu-buttonDanger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
.ddu-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:16px 18px}
.ddu-cardTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.02em;margin-bottom:12px;text-transform:uppercase}
.ddu-total{font-size:30px;font-weight:650;line-height:1.2}
.ddu-totalMeta{display:flex;gap:16px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:6px}
.ddu-row{display:flex;align-items:center;gap:10px;padding:7px 0}
.ddu-rowLabel{min-width:150px;flex:none;display:flex;flex-direction:column;gap:1px}
.ddu-rowName{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ddu-rowPath{font-size:11px;color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,monospace);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px}
.ddu-barWrap{flex:1;height:8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;min-width:60px}
.ddu-bar{height:100%;border-radius:4px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
.ddu-barWarn{background:var(--dsw-alias-state-warn-primary)}
.ddu-rowSize{min-width:86px;text-align:right;font-variant-numeric:tabular-nums;font-family:var(--ds-font-family-code,monospace);font-size:12.5px;flex:none}
.ddu-rowPct{min-width:44px;text-align:right;color:var(--dsw-alias-label-secondary);font-size:12px;flex:none}
.ddu-typeGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.ddu-typeChip{display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;font-size:12px;background:var(--dsw-alias-bg-layer-2)}
.ddu-typeExt{font-family:var(--ds-font-family-code,monospace);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddu-typeSize{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.ddu-cleanRow{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.ddu-cleanRow:last-child{border-bottom:none}
.ddu-check{margin-top:2px;accent-color:var(--dsw-alias-brand-primary);width:15px;height:15px;flex:none}
.ddu-cleanBody{flex:1;min-width:0}
.ddu-cleanName{font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ddu-badge{font-size:10.5px;font-weight:600;border-radius:5px;padding:1px 7px;letter-spacing:.03em;flex:none}
.ddu-badgeSafe{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}
.ddu-badgeCaution{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent)}
.ddu-cleanDesc{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px;line-height:1.5}
.ddu-cleanSize{min-width:86px;text-align:right;font-family:var(--ds-font-family-code,monospace);font-size:12.5px;flex:none;font-variant-numeric:tabular-nums}
.ddu-actions{display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap}
.ddu-banner{border-radius:10px;padding:10px 14px;font-size:13px;margin-top:12px}
.ddu-bannerOk{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
.ddu-bannerErr{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.ddu-bannerLog{font-size:12px;margin-top:6px;color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,monospace);word-break:break-all;white-space:pre-wrap}
.ddu-loading{display:flex;flex-direction:column;align-items:center;gap:12px;padding:64px 0;color:var(--dsw-alias-label-secondary)}
.ddu-spinner{width:22px;height:22px;border-radius:50%;border:2.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:ddu-spin 0.9s linear infinite}
@keyframes ddu-spin{to{transform:rotate(360deg)}}
.ddu-note{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6}
`;

		function createPage(t) {
			const CATEGORY_LABELS = {
				runtime: () => t('cat.runtime'),
				snapshots: () => t('cat.snapshots'),
				'npm-cache': () => t('cat.npm-cache'),
				pnpm: () => t('cat.pnpm'),
				browsers: () => t('cat.browsers'),
				sessions: () => t('cat.sessions'),
				skills: () => t('cat.skills'),
				attachments: () => t('cat.attachments'),
				profiles: () => t('cat.profiles'),
				home: () => t('cat.home'),
				venv: () => t('cat.venv'),
				superagent: () => t('cat.superagent'),
				logs: () => t('cat.logs'),
				other: () => t('cat.other')
			};
			const SUGGESTION_META = {
				'npm-cache': { level: 'safe' },
				'pnpm-store': { level: 'safe' },
				browsers: { level: 'safe' },
				'snapshots-old': { level: 'caution' },
				logs: { level: 'safe' },
				'bak-files': { level: 'safe' },
				venv: { level: 'caution' }
			};

			function CategoryRow({ entry, total }) {
				const pct = total > 0 ? (entry.bytes / total) * 100 : 0;
				const warn = entry.clean !== null && entry.bytes > 0;
				return h('div', { className: 'ddu-row' },
					h('div', { className: 'ddu-rowLabel' },
						h('div', { className: 'ddu-rowName' }, CATEGORY_LABELS[entry.id]?.() ?? entry.id),
						entry.path ? h('div', { className: 'ddu-rowPath', title: entry.path }, entry.path) : null),
					h('div', { className: 'ddu-barWrap' },
						h('div', { className: `ddu-bar${warn ? ' ddu-barWarn' : ''}`, style: { width: `${Math.max(pct, entry.bytes > 0 ? 1.2 : 0)}%` } })),
					h('div', { className: 'ddu-rowSize' }, formatBytes(entry.bytes)),
					h('div', { className: 'ddu-rowPct' }, pct >= 0.1 ? `${pct.toFixed(1)}%` : '<0.1%'));
			}

			function CleanupRow({ id, suggestion, checked, onToggle, t }) {
				const meta = SUGGESTION_META[id] ?? { level: 'caution' };
				return h('div', { className: 'ddu-cleanRow' },
					h('input', {
						className: 'ddu-check', type: 'checkbox', checked,
						onChange: () => onToggle(id),
						'aria-label': t(`clean.${id}`)
					}),
					h('div', { className: 'ddu-cleanBody' },
						h('div', { className: 'ddu-cleanName' },
							t(`clean.${id}`),
							h('span', { className: `ddu-badge ddu-badge${meta.level === 'safe' ? 'Safe' : 'Caution'}` },
								meta.level === 'safe' ? t('level.safe') : t('level.caution'))),
						h('div', { className: 'ddu-cleanDesc' }, t(`clean.${id}.desc`))),
					h('div', { className: 'ddu-cleanSize' }, formatBytes(suggestion.bytes)));
			}

			function DiskUsagePage() {
				const [report, setReport] = useState(null);
				const [loading, setLoading] = useState(true);
				const [error, setError] = useState(null);
				const [selected, setSelected] = useState(() => new Set());
				const [confirming, setConfirming] = useState(false);
				const [cleaning, setCleaning] = useState(false);
				const [cleanResult, setCleanResult] = useState(null);

				const load = useCallback(async () => {
					setLoading(true);
					setError(null);
					setCleanResult(null);
					setConfirming(false);
					try {
						const response = await fetch('api/disk-usage/scan', { headers: { accept: 'application/json' } });
						const data = await response.json();
						if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
						setReport(data);
					} catch (cause) {
						setError(cause instanceof Error ? cause.message : String(cause));
					} finally {
						setLoading(false);
					}
				}, []);

				useEffect(() => { load(); }, [load]);

				const toggle = useCallback((id) => {
					setSelected((prev) => {
						const next = new Set(prev);
						if (next.has(id)) next.delete(id);
						else next.add(id);
						return next;
					});
					setConfirming(false);
				}, []);

				const selectAllSafe = useCallback(() => {
					if (!report) return;
					const safe = Object.entries(report.suggestions)
						.filter(([, suggestion]) => suggestion.level === 'safe' && suggestion.bytes > 0)
						.map(([id]) => id);
					setSelected(new Set(safe));
					setConfirming(false);
				}, [report]);

				const selectedTotal = useMemo(() => {
					if (!report) return 0;
					let sum = 0;
					for (const id of selected) sum += report.suggestions[id]?.bytes ?? 0;
					return sum;
				}, [report, selected]);

				const runClean = useCallback(async () => {
					setCleaning(true);
					setConfirming(false);
					try {
						const response = await fetch('api/disk-usage/clean', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ targets: [...selected] })
						});
						const data = await response.json();
						if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
						setCleanResult(data);
						setSelected(new Set());
						await load();
					} catch (cause) {
						setError(cause instanceof Error ? cause.message : String(cause));
					} finally {
						setCleaning(false);
					}
				}, [selected, load]);

				if (loading && !report) {
					return h('div', { className: 'ddu-root' },
						h('div', { className: 'ddu-loading' },
							h('div', { className: 'ddu-spinner' }),
							t('loading')));
				}

				const scannedAt = report ? new Date(report.generatedAt).toLocaleString() : '';

				return h('div', { className: 'ddu-root' },
					h('div', { className: 'ddu-inner' },
						h('div', { className: 'ddu-header' },
							h('div', { style: { flex: '1', minWidth: 0 } },
								h('div', { className: 'ddu-title' }, t('panel')),
								h('div', { className: 'ddu-sub' }, report?.base ?? '')),
							h('button', { className: 'ddu-button', onClick: load, disabled: loading || cleaning }, t('refresh'))),

						error ? h('div', { className: 'ddu-banner ddu-bannerErr' }, `${t('error')}: ${error}`) : null,

						report && h(React.Fragment, null,
							h('div', { className: 'ddu-card' },
								h('div', { className: 'ddu-cardTitle' }, t('summary.title')),
								h('div', { className: 'ddu-total' }, formatBytes(report.totalBytes)),
								h('div', { className: 'ddu-totalMeta' },
									h('span', null, `${t('summary.files')}: ${report.totalFiles.toLocaleString()}`),
									h('span', null, `${t('summary.scannedAt')}: ${scannedAt}`),
									report.snapshotCount > 0 ? h('span', null, `${t('summary.snapshots')}: ${report.snapshotCount}`) : null,
									report.venvCount > 0 ? h('span', null, `${t('summary.venvs')}: ${report.venvCount}`) : null)),

							h('div', { className: 'ddu-card' },
								h('div', { className: 'ddu-cardTitle' }, t('categories.title')),
								report.categories
									.filter((entry) => entry.bytes > 0)
									.sort((a, b) => b.bytes - a.bytes)
									.map((entry) => h(CategoryRow, { key: entry.id, entry, total: report.totalBytes }))),

							h('div', { className: 'ddu-card' },
								h('div', { className: 'ddu-cardTitle' }, t('types.title')),
								h('div', { className: 'ddu-typeGrid' },
									report.fileTypes.map((type) =>
										h('div', { className: 'ddu-typeChip', key: type.ext },
											h('span', { className: 'ddu-typeExt', title: `${type.files.toLocaleString()} files` }, type.ext === 'none' ? t('types.none') : `.${type.ext}`),
											h('span', { className: 'ddu-typeSize' }, formatBytes(type.bytes))))),
								h('div', { className: 'ddu-note', style: { marginTop: 10 } }, t('types.note'))),

							h('div', { className: 'ddu-card' },
								h('div', { className: 'ddu-cardTitle' }, t('clean.title')),
								Object.entries(report.suggestions)
									.filter(([, suggestion]) => suggestion.bytes > 0 || suggestion.count > 0)
									.sort((a, b) => b[1].bytes - a[1].bytes)
									.map(([id, suggestion]) =>
										h(CleanupRow, {
											key: id, id, suggestion, t,
											checked: selected.has(id), onToggle: toggle
										})),
								h('div', { className: 'ddu-actions' },
									h('button', { className: 'ddu-button', onClick: selectAllSafe, disabled: cleaning }, t('clean.selectSafe')),
									h('span', { style: { flex: 1 } }),
									confirming
										? h('button', {
											className: 'ddu-button ddu-buttonDanger', onClick: runClean, disabled: cleaning || selected.size === 0
										}, `${t('clean.confirm')} (${selected.size})`)
										: h('button', {
											className: 'ddu-button ddu-buttonPrimary', onClick: () => setConfirming(true), disabled: cleaning || selected.size === 0
										}, `${t('clean.run')} (${selected.size})`)),
								confirming ? h('div', { className: 'ddu-note', style: { marginTop: 8 } }, t('clean.confirmHint')) : null,
								selected.size > 0 && h('div', { className: 'ddu-note', style: { marginTop: 8 } },
									`${t('clean.selectedSize')}: ${formatBytes(selectedTotal)}`),
								cleanResult && h('div', { className: `ddu-banner ${cleanResult.results.every((item) => item.ok) ? 'ddu-bannerOk' : 'ddu-bannerErr'}` },
									`${t('clean.freed')}: ${formatBytes(cleanResult.totalFreed)}`,
									cleanResult.results.filter((item) => !item.ok || item.error).length > 0
										? h('div', { className: 'ddu-bannerLog' },
											cleanResult.results
												.filter((item) => !item.ok || item.error)
												.map((item) => `${item.id}: ${item.error ?? 'failed'}`)
												.join('\n'))
										: null),
								h('div', { className: 'ddu-note', style: { marginTop: 12 } }, t('clean.footnote'))),

							report.errors && report.errors.length > 0 && h('div', { className: 'ddu-card' },
								h('div', { className: 'ddu-cardTitle' }, t('scanIssues.title')),
								h('div', { className: 'ddu-bannerLog' }, report.errors.join('\n'))))));
			}

			return DiskUsagePage;
		}

		// 静态 client.js 运行在普通脚本作用域，沙箱内置 styles 符号不存在，需自管 <style> 元素
		function insertStyles(css) {
			const el = document.createElement('style');
			el.setAttribute('data-dsh-disk-usage', '');
			el.textContent = css;
			document.head.append(el);
			return () => el.remove();
		}

		return {
			inject: ['slots', 'locale'],
			apply(ctx) {
				const disposeStyles = insertStyles(CSS);
				ctx.effect(() => ctx.locale.register(NS, {
					zh: {
						'panel': '磁盘空间',
						'loading': '正在扫描磁盘占用…',
						'refresh': '重新扫描',
						'error': '出错了',
						'summary.title': 'DSH 总占用',
						'summary.files': '文件数',
						'summary.scannedAt': '扫描时间',
						'summary.snapshots': '升级快照',
						'summary.venvs': '虚拟环境',
						'categories.title': '按目录分类',
						'types.title': '按文件类型',
						'types.none': '(无扩展名)',
						'types.note': '统计范围为整个 DSH 安装目录（含运行时、数据与工作区）。',
						'cat.runtime': 'DSH 运行时（依赖库）',
						'cat.snapshots': '升级快照',
						'cat.npm-cache': 'npm 缓存',
						'cat.pnpm': 'pnpm 存储',
						'cat.browsers': 'Playwright 浏览器',
						'cat.sessions': '会话数据',
						'cat.skills': '技能',
						'cat.attachments': '附件',
						'cat.profiles': '插件与配置',
						'cat.home': '工作区文件',
						'cat.venv': 'Python 虚拟环境',
						'cat.superagent': 'Superagent',
						'cat.logs': '日志',
						'cat.other': '其他',
						'clean.title': '清理建议',
						'level.safe': '安全',
						'level.caution': '谨慎',
						'clean.npm-cache': 'npm 缓存',
						'clean.npm-cache.desc': 'npm 下载缓存与 npx 临时包，删除后下次安装会重新下载。',
						'clean.pnpm-store': 'pnpm 存储仓库',
						'clean.pnpm-store.desc': 'pnpm 内容寻址存储；已安装的包不受影响（硬链接独立存在）。',
						'clean.browsers': 'Playwright 浏览器二进制',
						'clean.browsers.desc': 'Chromium 等浏览器可执行文件，删除后下次使用 browser-ops 技能时会重新下载。',
						'clean.snapshots-old': '旧升级快照',
						'clean.snapshots-old.desc': '保留最新一个快照，删除其余；快照用于版本回滚，确认不需要回滚旧版本时再清理。',
						'clean.logs': '运行日志',
						'clean.logs.desc': '截断 harness.log 与 info.log 并清空 logs 目录。',
						'clean.bak-files': '备份残留文件',
						'clean.bak-files.desc': '历次配置修改留下的 *.bak-* 备份文件。',
						'clean.venv': 'Python 虚拟环境',
						'clean.venv.desc': '工作区下的 venv 目录，可按需重建；正在运行的任务可能受影响。',
						'clean.selectSafe': '全选安全项',
						'clean.run': '清理所选项',
						'clean.confirm': '确认清理',
						'clean.confirmHint': '清理不可撤销，请再次点击“确认清理”执行。',
						'clean.selectedSize': '预计可释放',
						'clean.freed': '已释放',
						'clean.footnote': '清理只作用于服务端白名单目标，不会删除任意路径。',
						'scanIssues.title': '扫描中跳过的问题'
					},
					en: {
						'panel': 'Disk usage',
						'loading': 'Scanning disk usage…',
						'refresh': 'Rescan',
						'error': 'Error',
						'summary.title': 'Total DSH footprint',
						'summary.files': 'Files',
						'summary.scannedAt': 'Scanned at',
						'summary.snapshots': 'Snapshots',
						'summary.venvs': 'Virtual envs',
						'categories.title': 'By directory',
						'types.title': 'By file type',
						'types.none': '(no extension)',
						'types.note': 'Covers the whole DSH installation tree (runtime, data, and workspaces).',
						'cat.runtime': 'DSH runtime (dependencies)',
						'cat.snapshots': 'Upgrade snapshots',
						'cat.npm-cache': 'npm cache',
						'cat.pnpm': 'pnpm store',
						'cat.browsers': 'Playwright browsers',
						'cat.sessions': 'Session data',
						'cat.skills': 'Skills',
						'cat.attachments': 'Attachments',
						'cat.profiles': 'Plugins & config',
						'cat.home': 'Workspace files',
						'cat.venv': 'Python virtual envs',
						'cat.superagent': 'Superagent',
						'cat.logs': 'Logs',
						'cat.other': 'Other',
						'clean.title': 'Cleanup suggestions',
						'level.safe': 'Safe',
						'level.caution': 'Caution',
						'clean.npm-cache': 'npm cache',
						'clean.npm-cache.desc': 'Download cache and npx temporaries; re-downloaded on next install.',
						'clean.pnpm-store': 'pnpm store',
						'clean.pnpm-store.desc': 'Content-addressable store; installed packages keep working (hard links are independent).',
						'clean.browsers': 'Playwright browser binaries',
						'clean.browsers.desc': 'Chromium and friends; re-downloaded next time the browser-ops skill runs.',
						'clean.snapshots-old': 'Old upgrade snapshots',
						'clean.snapshots-old.desc': 'Keeps the newest snapshot and removes the rest; snapshots enable version rollback.',
						'clean.logs': 'Runtime logs',
						'clean.logs.desc': 'Truncates harness.log and info.log and empties the logs directory.',
						'clean.bak-files': 'Leftover backup files',
						'clean.bak-files.desc': '*.bak-* leftovers from earlier configuration edits.',
						'clean.venv': 'Python virtual envs',
						'clean.venv.desc': 'venv directories under workspaces; rebuildable, but running tasks may be affected.',
						'clean.selectSafe': 'Select all safe',
						'clean.run': 'Clean selected',
						'clean.confirm': 'Confirm clean',
						'clean.confirmHint': 'Cleanup is irreversible; click “Confirm clean” again to execute.',
						'clean.selectedSize': 'Estimated reclaim',
						'clean.freed': 'Freed',
						'clean.footnote': 'Cleanup only touches server-side whitelisted targets, never arbitrary paths.',
						'scanIssues.title': 'Skipped during scan'
					}
				}), 'dsh-disk-usage: dictionaries');

				const t = ctx.locale.bind(NS);
				const Page = createPage(t);

				ctx.effect(() => {
					const disposePanellist = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
						name: 'sidebar.panellist',
						id: PANEL_ID,
						order: 5,
						label: () => t('panel'),
						locale: NS
					}, DiskUsageIcon));
					const disposeMain = ctx.slots.inject('main', function* () {
						yield ctx.slots.register({
							name: 'main',
							key: PANEL_ID,
							locale: NS
						}, Page);
					});
					return () => {
						try { disposePanellist?.(); } catch { /* already gone */ }
						try { disposeMain?.(); } catch { /* already gone */ }
					};
				}, 'dsh-disk-usage: panel slots');

				ctx.effect(() => disposeStyles, 'dsh-disk-usage: styles');
			}
		};
	}
});
