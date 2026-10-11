const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const file = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(file.config, ts.sys, root);
const host = ts.createCompilerHost(config.options);
host.writeFile = (filename, text) => {
    const relative = path.relative(root, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Build output must stay within the project');
    // Avoid rewriting identical artifacts and use project-relative writes on Windows.
    if (fs.existsSync(relative) && fs.readFileSync(relative, 'utf8') === text) return;
    fs.mkdirSync(path.dirname(relative), { recursive: true });
    fs.writeFileSync(relative, text);
};
const program = ts.createProgram(config.fileNames, config.options, host);
const diagnostics = [...(file.error ? [file.error] : []), ...config.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => '\n' })); process.exitCode = 1;
} else {
    const result = program.emit();
    if (result.emitSkipped || result.diagnostics.length) { console.error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, host)); process.exitCode = 1; }
}
