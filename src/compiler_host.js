/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
"use strict";
const tsc_wrapped_1 = require("@angular/tsc-wrapped");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const EXT = /(\.ts|\.d\.ts|\.js|\.jsx|\.tsx)$/;
const DTS = /\.d\.ts$/;
const NODE_MODULES = '/node_modules/';
const IS_GENERATED = /\.(ngfactory|ngstyle)$/;
const GENERATED_FILES = /\.ngfactory\.ts$|\.ngstyle\.ts$/;
const GENERATED_OR_DTS_FILES = /\.d\.ts$|\.ngfactory\.ts$|\.ngstyle\.ts$/;
const SHALLOW_IMPORT = /^(\w+|(\@\w+\/\w+))$/;
class CompilerHost {
    constructor(program, options, context) {
        this.program = program;
        this.options = options;
        this.context = context;
        this.metadataCollector = new tsc_wrapped_1.MetadataCollector();
        this.resolverCache = new Map();
        // normalize the path so that it never ends with '/'.
        this.basePath = path.normalize(path.join(this.options.basePath, '.')).replace(/\\/g, '/');
        this.genDir = path.normalize(path.join(this.options.genDir, '.')).replace(/\\/g, '/');
        const genPath = path.relative(this.basePath, this.genDir);
        this.isGenDirChildOfRootDir = genPath === '' || !genPath.startsWith('..');
        this.resolveModuleNameHost = Object.create(this.context);
        // When calling ts.resolveModuleName,
        // additional allow checks for .d.ts files to be done based on
        // checks for .ngsummary.json files,
        // so that our codegen depends on fewer inputs and requires to be called
        // less often.
        // This is needed as we use ts.resolveModuleName in reflector_host
        // and it should be able to resolve summary file names.
        this.resolveModuleNameHost.fileExists = (fileName) => {
            if (this.context.fileExists(fileName)) {
                return true;
            }
            if (DTS.test(fileName)) {
                const base = fileName.substring(0, fileName.length - 5);
                return this.context.fileExists(base + '.ngsummary.json');
            }
            return false;
        };
    }
    // We use absolute paths on disk as canonical.
    getCanonicalFileName(fileName) { return fileName; }
    moduleNameToFileName(m, containingFile) {
        if (!containingFile || !containingFile.length) {
            if (m.indexOf('.') === 0) {
                throw new Error('Resolution of relative paths requires a containing file.');
            }
            // Any containing file gives the same result for absolute imports
            containingFile = this.getCanonicalFileName(path.join(this.basePath, 'index.ts'));
        }
        m = m.replace(EXT, '');
        const resolved = ts.resolveModuleName(m, containingFile.replace(/\\/g, '/'), this.options, this.resolveModuleNameHost)
            .resolvedModule;
        return resolved ? this.getCanonicalFileName(resolved.resolvedFileName) : null;
    }
    ;
    /**
     * We want a moduleId that will appear in import statements in the generated code.
     * These need to be in a form that system.js can load, so absolute file paths don't work.
     *
     * The `containingFile` is always in the `genDir`, where as the `importedFile` can be in
     * `genDir`, `node_module` or `basePath`.  The `importedFile` is either a generated file or
     * existing file.
     *
     *               | genDir   | node_module |  rootDir
     * --------------+----------+-------------+----------
     * generated     | relative |   relative  |   n/a
     * existing file |   n/a    |   absolute  |  relative(*)
     *
     * NOTE: (*) the relative path is computed depending on `isGenDirChildOfRootDir`.
     */
    fileNameToModuleName(importedFile, containingFile) {
        // If a file does not yet exist (because we compile it later), we still need to
        // assume it exists it so that the `resolve` method works!
        if (!this.context.fileExists(importedFile)) {
            this.context.assumeFileExists(importedFile);
        }
        containingFile = this.rewriteGenDirPath(containingFile);
        const containingDir = path.dirname(containingFile);
        // drop extension
        importedFile = importedFile.replace(EXT, '');
        const nodeModulesIndex = importedFile.indexOf(NODE_MODULES);
        const importModule = nodeModulesIndex === -1 ?
            null :
            importedFile.substring(nodeModulesIndex + NODE_MODULES.length);
        const isGeneratedFile = IS_GENERATED.test(importedFile);
        if (isGeneratedFile) {
            // rewrite to genDir path
            if (importModule) {
                // it is generated, therefore we do a relative path to the factory
                return this.dotRelative(containingDir, this.genDir + NODE_MODULES + importModule);
            }
            else {
                // assume that import is also in `genDir`
                importedFile = this.rewriteGenDirPath(importedFile);
                return this.dotRelative(containingDir, importedFile);
            }
        }
        else {
            // user code import
            if (importModule) {
                return importModule;
            }
            else {
                if (!this.isGenDirChildOfRootDir) {
                    // assume that they are on top of each other.
                    importedFile = importedFile.replace(this.basePath, this.genDir);
                }
                if (SHALLOW_IMPORT.test(importedFile)) {
                    return importedFile;
                }
                return this.dotRelative(containingDir, importedFile);
            }
        }
    }
    dotRelative(from, to) {
        const rPath = path.relative(from, to).replace(/\\/g, '/');
        return rPath.startsWith('.') ? rPath : './' + rPath;
    }
    /**
     * Moves the path into `genDir` folder while preserving the `node_modules` directory.
     */
    rewriteGenDirPath(filepath) {
        const nodeModulesIndex = filepath.indexOf(NODE_MODULES);
        if (nodeModulesIndex !== -1) {
            // If we are in node_modulse, transplant them into `genDir`.
            return path.join(this.genDir, filepath.substring(nodeModulesIndex));
        }
        else {
            // pretend that containing file is on top of the `genDir` to normalize the paths.
            // we apply the `genDir` => `rootDir` delta through `rootDirPrefix` later.
            return filepath.replace(this.basePath, this.genDir);
        }
    }
    getSourceFile(filePath) {
        const sf = this.program.getSourceFile(filePath);
        if (!sf) {
            if (this.context.fileExists(filePath)) {
                const sourceText = this.context.readFile(filePath);
                return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
            }
            throw new Error(`Source file ${filePath} not present in program.`);
        }
        return sf;
    }
    getMetadataFor(filePath) {
        if (!this.context.fileExists(filePath)) {
            // If the file doesn't exists then we cannot return metadata for the file.
            // This will occur if the user refernced a declared module for which no file
            // exists for the module (i.e. jQuery or angularjs).
            return;
        }
        if (DTS.test(filePath)) {
            const metadataPath = filePath.replace(DTS, '.metadata.json');
            if (this.context.fileExists(metadataPath)) {
                return this.readMetadata(metadataPath, filePath);
            }
            else {
                // If there is a .d.ts file but no metadata file we need to produce a
                // v3 metadata from the .d.ts file as v3 includes the exports we need
                // to resolve symbols.
                return [this.upgradeVersion1Metadata({ '__symbolic': 'module', 'version': 1, 'metadata': {} }, filePath)];
            }
        }
        else {
            const sf = this.getSourceFile(filePath);
            const metadata = this.metadataCollector.getMetadata(sf);
            return metadata ? [metadata] : [];
        }
    }
    readMetadata(filePath, dtsFilePath) {
        let metadatas = this.resolverCache.get(filePath);
        if (metadatas) {
            return metadatas;
        }
        try {
            const metadataOrMetadatas = JSON.parse(this.context.readFile(filePath));
            const metadatas = metadataOrMetadatas ?
                (Array.isArray(metadataOrMetadatas) ? metadataOrMetadatas : [metadataOrMetadatas]) :
                [];
            const v1Metadata = metadatas.find(m => m.version === 1);
            let v3Metadata = metadatas.find(m => m.version === 3);
            if (!v3Metadata && v1Metadata) {
                metadatas.push(this.upgradeVersion1Metadata(v1Metadata, dtsFilePath));
            }
            this.resolverCache.set(filePath, metadatas);
            return metadatas;
        }
        catch (e) {
            console.error(`Failed to read JSON file ${filePath}`);
            throw e;
        }
    }
    upgradeVersion1Metadata(v1Metadata, dtsFilePath) {
        // patch up v1 to v3 by merging the metadata with metadata collected from the d.ts file
        // as the only difference between the versions is whether all exports are contained in
        // the metadata and the `extends` clause.
        let v3Metadata = { '__symbolic': 'module', 'version': 3, 'metadata': {} };
        if (v1Metadata.exports) {
            v3Metadata.exports = v1Metadata.exports;
        }
        for (let prop in v1Metadata.metadata) {
            v3Metadata.metadata[prop] = v1Metadata.metadata[prop];
        }
        const exports = this.metadataCollector.getMetadata(this.getSourceFile(dtsFilePath));
        if (exports) {
            for (let prop in exports.metadata) {
                if (!v3Metadata.metadata[prop]) {
                    v3Metadata.metadata[prop] = exports.metadata[prop];
                }
            }
            if (exports.exports) {
                v3Metadata.exports = exports.exports;
            }
        }
        return v3Metadata;
    }
    loadResource(filePath) { return this.context.readResource(filePath); }
    loadSummary(filePath) {
        if (this.context.fileExists(filePath)) {
            return this.context.readFile(filePath);
        }
    }
    getOutputFileName(sourceFilePath) {
        return sourceFilePath.replace(EXT, '') + '.d.ts';
    }
    isSourceFile(filePath) {
        const excludeRegex = this.options.generateCodeForLibraries === false ? GENERATED_OR_DTS_FILES : GENERATED_FILES;
        return !excludeRegex.test(filePath);
    }
    calculateEmitPath(filePath) {
        // Write codegen in a directory structure matching the sources.
        let root = this.options.basePath;
        for (const eachRootDir of this.options.rootDirs || []) {
            if (this.options.trace) {
                console.error(`Check if ${filePath} is under rootDirs element ${eachRootDir}`);
            }
            if (path.relative(eachRootDir, filePath).indexOf('.') !== 0) {
                root = eachRootDir;
            }
        }
        // transplant the codegen path to be inside the `genDir`
        let relativePath = path.relative(root, filePath);
        while (relativePath.startsWith('..' + path.sep)) {
            // Strip out any `..` path such as: `../node_modules/@foo` as we want to put everything
            // into `genDir`.
            relativePath = relativePath.substr(3);
        }
        return path.join(this.options.genDir, relativePath);
    }
}
exports.CompilerHost = CompilerHost;
class CompilerHostContextAdapter {
    constructor() {
        this.assumedExists = {};
    }
    assumeFileExists(fileName) { this.assumedExists[fileName] = true; }
}
exports.CompilerHostContextAdapter = CompilerHostContextAdapter;
class ModuleResolutionHostAdapter extends CompilerHostContextAdapter {
    constructor(host) {
        super();
        this.host = host;
        if (host.directoryExists) {
            this.directoryExists = (directoryName) => host.directoryExists(directoryName);
        }
    }
    fileExists(fileName) {
        return this.assumedExists[fileName] || this.host.fileExists(fileName);
    }
    readFile(fileName) { return this.host.readFile(fileName); }
    readResource(s) {
        if (!this.host.fileExists(s)) {
            // TODO: We should really have a test for error cases like this!
            throw new Error(`Compilation failed. Resource file not found: ${s}`);
        }
        return Promise.resolve(this.host.readFile(s));
    }
}
exports.ModuleResolutionHostAdapter = ModuleResolutionHostAdapter;
class NodeCompilerHostContext extends CompilerHostContextAdapter {
    fileExists(fileName) {
        return this.assumedExists[fileName] || fs.existsSync(fileName);
    }
    directoryExists(directoryName) {
        try {
            return fs.statSync(directoryName).isDirectory();
        }
        catch (e) {
            return false;
        }
    }
    readFile(fileName) { return fs.readFileSync(fileName, 'utf8'); }
    readResource(s) {
        if (!this.fileExists(s)) {
            // TODO: We should really have a test for error cases like this!
            throw new Error(`Compilation failed. Resource file not found: ${s}`);
        }
        return Promise.resolve(this.readFile(s));
    }
}
exports.NodeCompilerHostContext = NodeCompilerHostContext;
//# sourceMappingURL=compiler_host.js.map