#!/usr/bin/env node
"use strict";
require('reflect-metadata');
var tsc = require('@angular/tsc-wrapped');
var codegen_1 = require('./codegen');
function codegen(ngOptions, program, host) {
    return codegen_1.CodeGenerator.create(ngOptions, program, host).codegen();
}
// CLI entry point
if (require.main === module) {
    var args = require('minimist')(process.argv.slice(2));
    tsc.main(args.p || args.project || '.', args.basePath, codegen)
        .then(function (exitCode) { return process.exit(exitCode); })
        .catch(function (e) {
        console.error(e.stack);
        console.error("Compilation failed");
        process.exit(1);
    });
}
//# sourceMappingURL=main.js.map