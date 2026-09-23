// 模板/SFC 结构编译校验：直接引用 node_modules（CJS 互操作），不打包
const { readFileSync } = require("node:fs");
const { parse, compileScript, compileTemplate } = require("@vue/compiler-sfc");

const files = ["src/App.vue", "src/components/StationMap.vue"];
let errors = 0;

for (const file of files) {
  const source = readFileSync(file, "utf-8");
  const { descriptor, errors: parseErrors } = parse(source, { filename: file });
  if (parseErrors.length) {
    console.error(file, "parse errors:", parseErrors);
    errors++;
    continue;
  }

  compileScript(descriptor, { id: file });

  if (descriptor.template) {
    const tpl = compileTemplate({
      source: descriptor.template.content,
      filename: file,
      id: file
    });
    if (tpl.errors.length) {
      console.error(file, "template errors:", tpl.errors);
      errors++;
    } else {
      console.log("PASS template compile:", file);
    }
  }
}

if (errors > 0) process.exit(1);
console.log("SFC 编译校验全部通过");
