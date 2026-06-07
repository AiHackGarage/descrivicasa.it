const fs = require('fs');
const c = fs.readFileSync('/opt/data/descrivicasa.it/index.html', 'utf8');

// Find the main script - it has "AUTH STATE" in it
const authIdx = c.indexOf('AUTH STATE');
const scriptStart = c.lastIndexOf('<script>', authIdx);
const scriptEnd = c.indexOf('</script>', authIdx);
const js = c.substring(scriptStart + 8, scriptEnd);

// Try to parse with Function constructor
try {
  new Function(js);
  console.log('✅ Main script parses OK');
} catch(e) {
  console.log('❌ Parse error:', e.message);
  const lines = js.split('\n');
  const errLine = e.lineNumber || 1;
  console.log('Around line', errLine, ':');
  for (let i = Math.max(0, errLine - 3); i < Math.min(lines.length, errLine + 3); i++) {
    const marker = i === errLine - 1 ? '>>>' : '   ';
    console.log(marker, (i+1) + ':', lines[i].substring(0, 150));
  }
}
