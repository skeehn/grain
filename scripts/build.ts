async function run(name: string, args: string[]): Promise<void> {
  const child = Bun.spawn(args, { cwd: process.cwd(), stdout: 'inherit', stderr: 'inherit' });
  const code = await child.exited; if (code !== 0) throw new Error(`${name} failed with exit code ${code}`);
}

await run('Node-compatible bundle', ['bun', 'build', '--target=node', '--outfile', 'dist/cli.js', 'src/cli.ts']);
await run('Bun standalone binary', ['bun', 'build', '--compile', '--target=bun', '--outfile', 'dist/grain', 'src/cli.ts']);
