import fs from '../storage/portableFs';
import path from 'node:path';
import ts from 'typescript';
import type Macros from '../Macros';
import type { MacroInfo } from '../../types';
import { toRunnableJs } from '../transpile';
import { safeHashEquals, sha256 } from './security';
import { PLUGIN_API_TYPES } from '../../../../common/pluginApiTypesSource';
import {
  validatePluginOptionSchema,
  type PluginOptionSchema,
} from '../../../../common/pluginOptions';

const NETWORK_MODULES = new Set([
  'axios',
  'discord.js',
  'http',
  'https',
  'node-fetch',
  'node:http',
  'node:https',
  'undici',
  'ws',
]);

const FORBIDDEN_MODULES = new Set([
  'child_process',
  'cluster',
  'electron',
  'node:child_process',
  'node:cluster',
  'node:vm',
  'vm',
]);

export type McpPluginProposal = {
  clientId: string;
  name: string;
  description?: string;
  language?: 'js' | 'ts';
  scriptType?: 'script' | 'action';
  source: string;
  optionSchema?: PluginOptionSchema;
  targetPluginId?: string;
};

type PreparedProposal = Required<
  Pick<
    McpPluginProposal,
    'clientId' | 'name' | 'source' | 'language' | 'scriptType'
  >
> & {
  description: string;
  targetPluginId?: string;
  sourceHash: string;
  imports: string[];
  optionSchema: PluginOptionSchema;
  networkRequested: boolean;
};

export class McpPluginInstaller {
  private readonly backupDirectory: string;
  private botMembers?: Set<string>;
  private scriptMembers?: Set<string>;

  constructor(
    private readonly macros: Macros,
    rootDirectory: string,
  ) {
    this.backupDirectory = path.join(rootDirectory, 'plugin-backups');
    fs.mkdirSync(this.backupDirectory, { recursive: true });
  }

  preview(input: {
    source: string;
    optionSchema?: PluginOptionSchema;
    targetPluginId?: string;
  }) {
    const source = this.requireSource(input.source);
    const optionSchema = validatePluginOptionSchema(input.optionSchema ?? []);
    const installed = input.targetPluginId
      ? this.macros.readPlugin(input.targetPluginId)
      : null;
    const before =
      installed && 'code' in installed && typeof installed.code === 'string'
        ? installed.code
        : '';
    const beforeLines = before.split('\n');
    const afterLines = source.split('\n');
    const changedLines: string[] = [];
    const count = Math.max(beforeLines.length, afterLines.length);
    for (let index = 0; index < count; index += 1) {
      if (beforeLines[index] === afterLines[index]) continue;
      if (beforeLines[index] !== undefined)
        changedLines.push(`-${index + 1} ${beforeLines[index]}`);
      if (afterLines[index] !== undefined)
        changedLines.push(`+${index + 1} ${afterLines[index]}`);
      if (changedLines.length >= 400) break;
    }
    const beforeOptionSchema = input.targetPluginId
      ? this.macros.readPluginInfo(input.targetPluginId)?.config ?? []
      : [];
    return {
      sourceHash: sha256(source),
      before,
      after: source,
      changedLines,
      optionSchema: {
        before: beforeOptionSchema,
        after: optionSchema,
        changed: JSON.stringify(beforeOptionSchema) !== JSON.stringify(optionSchema),
      },
    };
  }

  async validate(
    input: {
      source: string;
      language?: 'js' | 'ts';
      scriptType?: 'script' | 'action';
      optionSchema?: PluginOptionSchema;
    },
    allowNetwork: boolean,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const source = this.requireSource(input.source);
    const imports = this.imports(source);
    const errors = this.importErrors(imports, allowNetwork);
    validatePluginOptionSchema(input.optionSchema ?? []);
    errors.push(...this.validateSource(
      source,
      input.language ?? 'js',
      input.scriptType ?? 'script',
    ));
    try {
      const runnable = await toRunnableJs(source, input.language ?? 'js');
      new Function('require', 'module', 'exports', runnable);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    return { valid: errors.length === 0, errors };
  }

  async install(
    input: McpPluginProposal,
    allowNetwork: boolean,
  ): Promise<{ pluginId: string; sourceHash: string; backupPath?: string }> {
    const proposal = this.prepare(input);
    const validation = await this.validate(proposal, allowNetwork);
    if (!validation.valid) throw new Error(validation.errors.join('\n'));
    if (proposal.targetPluginId)
      return this.updatePlugin(proposal, allowNetwork);
    return this.createPlugin(proposal, allowNetwork);
  }

  installedSourceHash(pluginId: string): string | undefined {
    const source = this.macros.readPlugin(pluginId);
    return source && 'code' in source && typeof source.code === 'string'
      ? sha256(source.code)
      : undefined;
  }

  private createPlugin(
    proposal: PreparedProposal,
    allowNetwork: boolean,
  ): { pluginId: string; sourceHash: string } {
    const created = this.macros.create({
      name: proposal.name,
      description: proposal.description,
      language: proposal.language,
      scriptType: proposal.scriptType,
    });
    if (!created || created.status !== 'success' || !('pluginId' in created))
      throw new Error('Could not create the plugin.');
    try {
      this.macros.save(created.pluginId, { code: proposal.source });
      const info = this.macros.readPluginInfo(created.pluginId);
      if (!info) throw new Error('Plugin metadata was not persisted.');
      this.macros.saveInfo({
        ...info,
        config: proposal.optionSchema,
      });
      this.macros.setAiProvenance(
        created.pluginId,
        this.provenance(proposal, allowNetwork),
      );
      this.assertInstalled(created.pluginId, proposal.sourceHash);
      this.macros.invalidateLocalCache();
      return { pluginId: created.pluginId, sourceHash: proposal.sourceHash };
    } catch (error) {
      this.macros.delete(created.pluginId);
      throw error;
    }
  }

  private updatePlugin(
    proposal: PreparedProposal,
    allowNetwork: boolean,
  ): { pluginId: string; sourceHash: string; backupPath: string } {
    const pluginId = proposal.targetPluginId as string;
    if (!/^[a-z0-9]+$/i.test(pluginId)) throw new Error('Invalid plugin id.');
    const info = this.macros.readPluginInfo(pluginId);
    if (!info) throw new Error('Target plugin not found.');
    const backupPath = this.backup(pluginId, info);
    const codePath = this.macros.codeFilePath(pluginId, proposal.language);
    const infoPath = path.join(this.macros.macros_path, `_${pluginId}.json`);
    const nextInfo: MacroInfo = {
      ...info,
      name: proposal.name,
      description: proposal.description,
      language: proposal.language,
      scriptType: proposal.scriptType,
      config: proposal.optionSchema,
      editedAt: Date.now(),
    };
    delete nextInfo.security;
    fs.writeFileSync(`${codePath}.tmp`, proposal.source);
    fs.writeFileSync(`${infoPath}.tmp`, JSON.stringify(nextInfo));
    fs.renameSync(`${codePath}.tmp`, codePath);
    fs.renameSync(`${infoPath}.tmp`, infoPath);
    ['.js', '.ts', '.json'].forEach((extension) => {
      const stale = path.join(
        this.macros.macros_path,
        `${pluginId}${extension}`,
      );
      if (stale !== codePath && fs.existsSync(stale)) fs.unlinkSync(stale);
    });
    this.macros.setAiProvenance(
      pluginId,
      this.provenance(proposal, allowNetwork),
    );
    this.macros.invalidateLocalCache();
    this.assertInstalled(pluginId, proposal.sourceHash);
    return { pluginId, sourceHash: proposal.sourceHash, backupPath };
  }

  private prepare(input: McpPluginProposal): PreparedProposal {
    const source = this.requireSource(input.source);
    const imports = this.imports(source);
    return {
      clientId: input.clientId,
      name: input.name.slice(0, 100),
      description: (input.description ?? '').slice(0, 500),
      language: input.language ?? 'js',
      scriptType: input.scriptType ?? 'script',
      source,
      optionSchema: validatePluginOptionSchema(input.optionSchema ?? []),
      targetPluginId: input.targetPluginId,
      sourceHash: sha256(source),
      imports,
      networkRequested:
        imports.some((name) => NETWORK_MODULES.has(name)) ||
        /axios|fetch\s*\(|https?\.|discord|WebSocket/i.test(source),
    };
  }

  private imports(source: string): string[] {
    const imports = new Set<string>();
    const pattern =
      /(?:require\s*\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"])/g;
    for (const match of source.matchAll(pattern))
      imports.add(match[1] ?? match[2] ?? match[3]);
    return [...imports];
  }

  private importErrors(imports: string[], allowNetwork: boolean): string[] {
    return imports.flatMap((name) => {
      if (FORBIDDEN_MODULES.has(name))
        return [`Import "${name}" is not allowed for AI plugins.`];
      if (!allowNetwork && NETWORK_MODULES.has(name))
        return [`Import "${name}" needs plugin network permission.`];
      return [];
    });
  }

  private validateSource(
    source: string,
    language: 'js' | 'ts',
    scriptType: 'script' | 'action',
  ): string[] {
    const errors: string[] = [];
    const fileName = language === 'ts' ? 'plugin.ts' : 'plugin.js';
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.ES2021,
      true,
      language === 'ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS,
    );
    for (const diagnostic of sourceFile.parseDiagnostics)
      errors.push(`Syntax error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);

    if (scriptType === 'action') {
      errors.push(...this.actionContract(sourceFile));
      const directBotMembers = this.directBotMembers(sourceFile);
      const supportedBotMembers = this.publicBotMembers();
      for (const member of directBotMembers)
        if (!supportedBotMembers.has(member))
          errors.push(
            `Unknown bot API: bot.${member}. Read get_plugin(mode: "authoring") or get_jnbot_reference(section: "botApi") before retrying.`,
          );
      if (/bot\.chat\s*\(\s*['"]\//.test(source) && /(?:onceWithTimeout|\.once)\s*\(\s*['"]windowOpen['"]/.test(source))
        errors.push(
          'Use await bot.openWindow(command, options) instead of bot.chat(command) followed by a windowOpen wait.',
        );
    }
    const supportedScriptMembers = this.publicScriptMembers();
    for (const member of this.directScriptMembers(sourceFile))
      if (!supportedScriptMembers.has(member))
        errors.push(
          `Unknown script API: script.${member}. Read get_plugin(mode: "authoring") or get_jnbot_reference(section: "pluginApi") before retrying.`,
        );
    if (language === 'ts') errors.push(...this.typeDiagnostics(fileName, source, language));
    return [...new Set(errors)];
  }

  private actionContract(sourceFile: ts.SourceFile): string[] {
    const main = sourceFile.statements.find(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === 'main',
    );
    if (!main)
      return ['Action plugins must declare async function main(bot, settings, args = []).'];
    if (!main.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword))
      return ['Action main must be async: async function main(bot, settings, args = []).'];
    if (main.parameters.length < 2 || main.parameters.length > 3)
      return ['Action main must accept bot, settings, and optional args only.'];
    return [];
  }

  private typeDiagnostics(
    fileName: string,
    source: string,
    language: 'js' | 'ts',
  ): string[] {
    const declarationFile = 'jnbot.d.ts';
    const options: ts.CompilerOptions = {
      allowJs: language === 'js',
      checkJs: language === 'js',
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
    };
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, target, onError, shouldCreateNewSourceFile) => {
      if (name === fileName)
        return ts.createSourceFile(
          name,
          source,
          target,
          true,
          language === 'ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS,
        );
      if (name === declarationFile)
        return ts.createSourceFile(name, PLUGIN_API_TYPES, target, true, ts.ScriptKind.TS);
      return originalGetSourceFile(name, target, onError, shouldCreateNewSourceFile);
    };
    host.fileExists = (name) => name === fileName || name === declarationFile || fs.existsSync(name);
    host.readFile = (name) =>
      name === fileName ? source : name === declarationFile ? PLUGIN_API_TYPES : fs.readFileSync(name, 'utf8');
    const program = ts.createProgram([declarationFile, fileName], options, host);
    return ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file?.fileName === fileName)
      .map((diagnostic) => `Type error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
  }

  private directBotMembers(sourceFile: ts.SourceFile): Set<string> {
    const members = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'bot'
      )
        members.add(node.name.text);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return members;
  }

  private directScriptMembers(sourceFile: ts.SourceFile): Set<string> {
    const members = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'script'
      ) members.add(node.name.text);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return members;
  }

  private publicBotMembers(): Set<string> {
    if (this.botMembers) return this.botMembers;
    const names = new Set<string>();
    const source = ts.createSourceFile(
      'jnbot.d.ts',
      PLUGIN_API_TYPES,
      ts.ScriptTarget.ES2021,
      true,
      ts.ScriptKind.TS,
    );
    const collect = (members: ts.NodeArray<ts.TypeElement>) => {
      for (const member of members) {
        const name = member.name;
        if (name && ts.isIdentifier(name)) names.add(name.text);
      }
    };
    const visit = (node: ts.Node): void => {
      if (
        (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
        (node.name.text === 'MineflayerBot' || node.name.text === 'BotPluginExtensions')
      ) {
        if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) collect(node.type.members);
        if (ts.isInterfaceDeclaration(node)) collect(node.members);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    this.botMembers = names;
    return names;
  }

  private publicScriptMembers(): Set<string> {
    if (this.scriptMembers) return this.scriptMembers;
    this.scriptMembers = this.publicInterfaceMembers('ScriptAPI');
    return this.scriptMembers;
  }

  private publicInterfaceMembers(interfaceName: string): Set<string> {
    const names = new Set<string>();
    const source = ts.createSourceFile(
      'jnbot.d.ts', PLUGIN_API_TYPES, ts.ScriptTarget.ES2021, true, ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName)
        for (const member of node.members)
          if (member.name && ts.isIdentifier(member.name)) names.add(member.name.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    return names;
  }

  private provenance(proposal: PreparedProposal, allowNetwork: boolean) {
    return {
      sourceHash: proposal.sourceHash,
      firstRunApprovedHash: proposal.sourceHash,
      clientId: proposal.clientId,
      networkAllowed: proposal.networkRequested && allowNetwork,
    };
  }

  private backup(pluginId: string, info: MacroInfo): string {
    const destination = path.join(
      this.backupDirectory,
      `${pluginId}-${Date.now()}`,
    );
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'info.json'), JSON.stringify(info));
    fs.writeFileSync(
      path.join(destination, 'code.json'),
      JSON.stringify(this.macros.readPlugin(pluginId)),
    );
    return destination;
  }

  private assertInstalled(pluginId: string, sourceHash: string): void {
    const listed = this.macros
      .toList()
      .some((plugin) => plugin.pluginId === pluginId);
    if (
      !this.macros.readPluginInfo(pluginId) ||
      !listed ||
      !safeHashEquals(this.installedSourceHash(pluginId) ?? '', sourceHash)
    )
      throw new Error('Plugin installation could not be verified.');
  }

  private requireSource(source: string): string {
    if (typeof source !== 'string' || !source.trim())
      throw new Error('Plugin source is required.');
    if (Buffer.byteLength(source) > 512 * 1024)
      throw new Error('Plugin source is limited to 512 KiB.');
    return source;
  }
}

export default McpPluginInstaller;
