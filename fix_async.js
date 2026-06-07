const fs = require('fs');
let c = fs.readFileSync('/opt/data/descrivicasa.it/index.html', 'utf8');

// Fix: the async keyword got detached from showPropertyDetail
// Current: "async \n        function addDots(n) {\n...}\nfunction showPropertyDetail"
// Should be: "function addDots(n) {\n...}\n        async function showPropertyDetail"

c = c.replace(
  'async \n        function addDots(n) {\n            return n.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, \'.\');\n        }\nfunction showPropertyDetail(id) {',
  'function addDots(n) {\n            return n.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, \'.\');\n        }\n        async function showPropertyDetail(id) {'
);

fs.writeFileSync('/opt/data/descrivicasa.it/index.html', c, 'utf8');

// Verify
c = fs.readFileSync('/opt/data/descrivicasa.it/index.html', 'utf8');
const idx = c.indexOf('async function showPropertyDetail');
if (idx > 0) {
  console.log('OK: async function showPropertyDetail found');
} else {
  console.log('ERROR: pattern not found. Context:');
  const addDotsIdx = c.indexOf('function addDots');
  if (addDotsIdx > 0) {
    console.log(c.substring(addDotsIdx, addDotsIdx + 200));
  }
}

// Check for remaining detached async
const asyncAlone = c.match(/^\s+async\s+$/m);
if (asyncAlone) {
  console.log('WARNING: still has detached async!');
}
