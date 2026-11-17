import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import stylelint from 'stylelint';

const base = process.argv[2] || 'HEAD';
const app = fileURLToPath(new URL('..', import.meta.url));
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: app, encoding: 'utf8' }).trim();
const points = 'frontend/app/points/src';
const cssConfig = fileURLToPath(new URL('../stylelint.points.config.mjs', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

function inlineStyles(source, filename) {
  const findings = [];
  const tree = parse(source, { sourceFilename: filename, sourceType: 'module', plugins: ['jsx', 'typescript'] });
  const sizeProps = /^(?:fontSize|(?:border\w*)?Radius)$/i;
  const colorProps = /(?:color|background|fill|stroke|shadow|border(?:Top|Right|Bottom|Left)?)$/i;
  const rawColor = /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[-.\d]/i;
  const neutral = /^(?:none|transparent|currentcolor|inherit|initial|unset|revert(?:-layer)?)$/i;
  const rawSize = /\b\d*\.?\d+(?:px|r?em|[dls]?v[hw]|pt|%)\b/i;

  function inspectValue(name, value) {
    if (!value) return;
    if (value.type === 'ConditionalExpression') {
      inspectValue(name, value.consequent);
      inspectValue(name, value.alternate);
      return;
    }
    if (value.type === 'LogicalExpression') {
      inspectValue(name, value.left);
      inspectValue(name, value.right);
      return;
    }
    const literal = value.type === 'TemplateLiteral'
      ? value.quasis.map(part => part.value.raw).join('…')
      : value.value;
    const raw = typeof literal === 'number'
      ? literal !== 0 && sizeProps.test(name)
      : typeof literal === 'string' && (
        (sizeProps.test(name) && rawSize.test(literal) && !literal.includes('var('))
        || (colorProps.test(name) && rawColor.test(literal))
        || (/^(?:.*color|background|fill|stroke)$/i.test(name) && /^[a-z]+$/i.test(literal) && !neutral.test(literal))
      );
    if (raw) findings.push({ line: value.loc.start.line, message: `Use a design token for ${name}: ${literal}` });
  }

  function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'JSXAttribute' && node.name.name === 'style') {
      const expression = node.value?.expression;
      if (expression?.type !== 'ObjectExpression') return;
      for (const prop of expression.properties) {
        if (prop.type !== 'ObjectProperty' || prop.computed) continue;
        const name = prop.key.name || prop.key.value || '';
        inspectValue(name, prop.value);
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  }

  visit(tree);
  return findings;
}

async function cssStyles(code, file) {
  const { results } = await stylelint.lint({ code, codeFilename: file, configFile: cssConfig, quietDeprecationWarnings: true });
  return results.flatMap(result => result.warnings.map(({ line, text }) => ({ line, message: text })));
}

function introduced(before, after) {
  const existing = new Map();
  for (const item of before) existing.set(item.message, (existing.get(item.message) || 0) + 1);
  return after.filter(item => {
    const count = existing.get(item.message) || 0;
    if (count === 0) return true;
    existing.set(item.message, count - 1);
    return false;
  });
}

const paths = new Set(git('diff', '--name-only', '--diff-filter=ACM', '--no-renames', '-z', base, '--', points).split('\0'));
for (const file of git('ls-files', '--others', '--exclude-standard', '-z', '--', points).split('\0')) paths.add(file);
const trackedAtBase = new Set(git('ls-tree', '-r', '--name-only', '-z', base, '--', points).split('\0'));
const fileFindings = await Promise.all([...paths].filter(file => /\.(?:css|jsx|tsx)$/.test(file) && !file.includes('/demo/')).map(async file => {
  const filename = path.join(root, file);
  const check = file.endsWith('.css') ? cssStyles : inlineStyles;
  const source = await readFile(filename, 'utf8');
  const before = trackedAtBase.has(file) ? await check(git('show', `${base}:${file}`), filename) : [];
  const after = await check(source, filename);
  return introduced(before, after).map(({ line, message }) => `${file}:${line} ${message}`);
}));

const violations = fileFindings.flat();
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Points design token check passed.');
}
