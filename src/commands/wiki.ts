import { WikiEngine, startWikiServer } from '../wiki/index.js';

export async function handleWikiCommand(subcommand = 'search', argument?: string): Promise<void> {
  const wiki = new WikiEngine();
  if (subcommand === 'build') {
    // The file index remains a page; the generated architecture and subsystem
    // pages are what make the wiki worth reading and verifiable.
    const index = wiki.build();
    const pages = await wiki.buildAll();
    console.log([index, ...pages].map(page => `${page.path}  (${page.sources.length} sources)`).join('\n'));
    console.log(`Built ${pages.length + 1} page(s).`);
    const sync = await wiki.sync();
    if (sync.ok) console.log(`Synced ${sync.indexed} page(s), ${sync.edges} link edge(s) to engram memory.`);
    return;
  }
  if (subcommand === 'sync') {
    const sync = await wiki.sync();
    console.log(sync.ok
      ? `Synced ${sync.indexed} wiki page(s) and ${sync.edges} [[link]] edge(s) into engram memory.`
      : 'engram memory server not reachable — nothing synced (wiki still works offline).');
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
