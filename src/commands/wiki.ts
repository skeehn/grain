import { WikiEngine, startWikiServer } from '../wiki/index.js';

export async function handleWikiCommand(subcommand = 'search', argument?: string): Promise<void> {
  const wiki = new WikiEngine();
  if (subcommand === 'build') {
    const page = wiki.build();
    console.log(`Built ${page.path} with ${page.sources.length} source references.`);
    return;
  }
  if (subcommand === 'search') {
    if (!argument) throw new Error('Usage: grain wiki search <query>');
    const pages = wiki.search(argument);
    console.log(pages.length ? pages.map(page => `${page.id}\t${page.title}\t${page.status}`).join('\n') : 'No wiki results.');
    return;
  }
  if (subcommand === 'show') {
    if (!argument) throw new Error('Usage: grain wiki show <id>');
    const page = wiki.get(argument);
    if (!page) throw new Error(`Wiki page not found: ${argument}`);
    console.log(page.body);
    console.log(`\nSources:\n${page.sources.map(source => `${source.path}:${source.start_line}-${source.end_line}`).join('\n')}`);
    return;
  }
  if (subcommand === 'verify') {
    const result = wiki.verify();
    if (result.valid) { console.log('Wiki provenance is current.'); return; }
    console.error(result.stale.map(item => `${item.page}: ${item.source} — ${item.reason}`).join('\n'));
    process.exitCode = 1;
    return;
  }
  if (subcommand === 'diff') { console.log(wiki.diff()); return; }
  if (subcommand === 'serve') {
    const port = Number(argument || 7331);
    startWikiServer(port);
    console.log(`Grain wiki: http://127.0.0.1:${port}`);
    return;
  }
  throw new Error(`Unknown wiki command: ${subcommand}`);
}
