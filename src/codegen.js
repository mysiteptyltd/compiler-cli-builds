/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
"use strict";
/**
 * Transform template html and css into executable code.
 * Intended to be used in a build step.
 */
var compiler = require('@angular/compiler');
var core_1 = require('@angular/core');
var path = require('path');
var path_mapped_reflector_host_1 = require('./path_mapped_reflector_host');
var private_import_core_1 = require('./private_import_core');
var reflector_host_1 = require('./reflector_host');
var static_reflection_capabilities_1 = require('./static_reflection_capabilities');
var static_reflector_1 = require('./static_reflector');
var nodeFs = require('fs');
var GENERATED_FILES = /\.ngfactory\.ts$|\.css\.ts$|\.css\.shim\.ts$/;
var GENERATED_OR_DTS_FILES = /\.d\.ts$|\.ngfactory\.ts$|\.css\.ts$|\.css\.shim\.ts$/;
var PREAMBLE = "/**\n * @fileoverview This file is generated by the Angular 2 template compiler.\n * Do not edit.\n * @suppress {suspiciousCode,uselessCode,missingProperties}\n */\n /* tslint:disable */\n\n";
var CodeGenerator = (function () {
    function CodeGenerator(options, program, host, staticReflector, compiler, reflectorHost) {
        this.options = options;
        this.program = program;
        this.host = host;
        this.staticReflector = staticReflector;
        this.compiler = compiler;
        this.reflectorHost = reflectorHost;
    }
    // Write codegen in a directory structure matching the sources.
    CodeGenerator.prototype.calculateEmitPath = function (filePath) {
        var root = this.options.basePath;
        for (var _i = 0, _a = this.options.rootDirs || []; _i < _a.length; _i++) {
            var eachRootDir = _a[_i];
            if (this.options.trace) {
                console.log("Check if " + filePath + " is under rootDirs element " + eachRootDir);
            }
            if (path.relative(eachRootDir, filePath).indexOf('.') !== 0) {
                root = eachRootDir;
            }
        }
        // transplant the codegen path to be inside the `genDir`
        var relativePath = path.relative(root, filePath);
        while (relativePath.startsWith('..' + path.sep)) {
            // Strip out any `..` path such as: `../node_modules/@foo` as we want to put everything
            // into `genDir`.
            relativePath = relativePath.substr(3);
        }
        return path.join(this.options.genDir, relativePath);
    };
    CodeGenerator.prototype.codegen = function (options) {
        var _this = this;
        var staticSymbols = extractProgramSymbols(this.program, this.staticReflector, this.reflectorHost, this.options);
        return this.compiler.compileModules(staticSymbols, options).then(function (generatedModules) {
            generatedModules.forEach(function (generatedModule) {
                var sourceFile = _this.program.getSourceFile(generatedModule.fileUrl);
                var emitPath = _this.calculateEmitPath(generatedModule.moduleUrl);
                _this.host.writeFile(emitPath, PREAMBLE + generatedModule.source, false, function () { }, [sourceFile]);
            });
        });
    };
    CodeGenerator.create = function (options, cliOptions, program, compilerHost, reflectorHostContext, resourceLoader, reflectorHost) {
        resourceLoader = resourceLoader || {
            get: function (s) {
                if (!compilerHost.fileExists(s)) {
                    // TODO: We should really have a test for error cases like this!
                    throw new Error("Compilation failed. Resource file not found: " + s);
                }
                return Promise.resolve(compilerHost.readFile(s));
            }
        };
        var transFile = cliOptions.i18nFile;
        var locale = cliOptions.locale;
        var transContent = '';
        if (transFile) {
            if (!locale) {
                throw new Error("The translation file (" + transFile + ") locale must be provided. Use the --locale option.");
            }
            transContent = nodeFs.readFileSync(transFile, 'utf8');
        }
        var urlResolver = compiler.createOfflineCompileUrlResolver();
        if (!reflectorHost) {
            var usePathMapping = !!options.rootDirs && options.rootDirs.length > 0;
            reflectorHost = usePathMapping ?
                new path_mapped_reflector_host_1.PathMappedReflectorHost(program, compilerHost, options, reflectorHostContext) :
                new reflector_host_1.ReflectorHost(program, compilerHost, options, reflectorHostContext);
        }
        var staticReflector = new static_reflector_1.StaticReflector(reflectorHost);
        static_reflection_capabilities_1.StaticAndDynamicReflectionCapabilities.install(staticReflector);
        var htmlParser = new compiler.I18NHtmlParser(new compiler.HtmlParser(), transContent, cliOptions.i18nFormat);
        var config = new compiler.CompilerConfig({
            genDebugInfo: options.debug === true,
            defaultEncapsulation: core_1.ViewEncapsulation.Emulated,
            logBindingUpdate: false,
            useJit: false
        });
        var normalizer = new compiler.DirectiveNormalizer(resourceLoader, urlResolver, htmlParser, config);
        var expressionParser = new compiler.Parser(new compiler.Lexer());
        var elementSchemaRegistry = new compiler.DomElementSchemaRegistry();
        var console = new private_import_core_1.Console();
        var tmplParser = new compiler.TemplateParser(expressionParser, elementSchemaRegistry, htmlParser, console, []);
        var resolver = new compiler.CompileMetadataResolver(new compiler.NgModuleResolver(staticReflector), new compiler.DirectiveResolver(staticReflector), new compiler.PipeResolver(staticReflector), elementSchemaRegistry, staticReflector);
        // TODO(vicb): do not pass cliOptions.i18nFormat here
        var offlineCompiler = new compiler.OfflineCompiler(resolver, normalizer, tmplParser, new compiler.StyleCompiler(urlResolver), new compiler.ViewCompiler(config, elementSchemaRegistry), new compiler.DirectiveWrapperCompiler(config, expressionParser, elementSchemaRegistry, console), new compiler.NgModuleCompiler(), new compiler.TypeScriptEmitter(reflectorHost), cliOptions.locale, cliOptions.i18nFormat, new compiler.AnimationParser(elementSchemaRegistry));
        return new CodeGenerator(options, program, compilerHost, staticReflector, offlineCompiler, reflectorHost);
    };
    return CodeGenerator;
}());
exports.CodeGenerator = CodeGenerator;
function extractProgramSymbols(program, staticReflector, reflectorHost, options) {
    // Compare with false since the default should be true
    var skipFileNames = options.generateCodeForLibraries === false ? GENERATED_OR_DTS_FILES : GENERATED_FILES;
    var staticSymbols = [];
    program.getSourceFiles()
        .filter(function (sourceFile) { return !skipFileNames.test(sourceFile.fileName); })
        .forEach(function (sourceFile) {
        var absSrcPath = reflectorHost.getCanonicalFileName(sourceFile.fileName);
        var moduleMetadata = staticReflector.getModuleMetadata(absSrcPath);
        if (!moduleMetadata) {
            console.log("WARNING: no metadata found for " + absSrcPath);
            return;
        }
        var metadata = moduleMetadata['metadata'];
        if (!metadata) {
            return;
        }
        for (var _i = 0, _a = Object.keys(metadata); _i < _a.length; _i++) {
            var symbol = _a[_i];
            if (metadata[symbol] && metadata[symbol].__symbolic == 'error') {
                // Ignore symbols that are only included to record error information.
                continue;
            }
            staticSymbols.push(reflectorHost.findDeclaration(absSrcPath, symbol, absSrcPath));
        }
    });
    return staticSymbols;
}
exports.extractProgramSymbols = extractProgramSymbols;
//# sourceMappingURL=codegen.js.map