// postinstall script — runs after npm install -g
try {
  if (process.env.CI || process.env.DOCKER) process.exit(0);

  console.log('');
  console.log('minipet-overlay installed!');
  console.log('');
  console.log('   Start: minipet-overlay start');
  console.log('');
} catch {
  // ignore all errors during postinstall
}
