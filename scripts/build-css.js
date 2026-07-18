const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sources = [
  ['Base', 'public/css/style.css'],
  ['Experience', 'public/css/experience.css'],
  ['Nova', 'public/css/nova.css']
];
const output = path.join(root, 'public/css/madrador.css');

const content = sources.map(([label, relativePath]) => {
  const absolutePath = path.join(root, relativePath);
  return `/* ${label}: ${relativePath} */\n${fs.readFileSync(absolutePath, 'utf8').trim()}\n`;
}).join('\n');

fs.writeFileSync(output, `${content}\n`, 'utf8');
console.log(`Built ${path.relative(root, output)} from ${sources.length} ordered sources (${Buffer.byteLength(content)} bytes).`);
