'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const acorn = require('acorn');
const walk = require('acorn/dist/walk');
const esutils = require('esutils');

function extractExports(source) {
  const exportedValues = {};
  const ast = acorn.parse(source, { sourceType: 'module' });

  walk.simple(ast, {
    AssignmentExpression(node) {
      const isValuesExport =
        node.left.type === 'MemberExpression' &&
        node.left.object.name === '___CSS_LOADER_EXPORT___' &&
        node.left.property.name === 'locals';

      if (isValuesExport && node.right.type === 'ObjectExpression') {
        for (const property of node.right.properties) {
          // The key can be an identifier or a string literal
          const key =
            property.type === 'Identifier'
              ? property.key.name
              : property.key.value;

          // Filter out invalid identifiers. Depending on the configuration, css-loader might not remove the original non-camelcased keys.
          // https://github.com/webpack-contrib/css-loader#camelcase
          if (!esutils.keyword.isIdentifierNameES6(key)) {
            continue;
          }

          // Filter out reserved keywords
          if (esutils.keyword.isReservedWordES6(key, true)) {
            continue;
          }

          exportedValues[key] = true;
        }
      }
    }
  });

  return exportedValues;
}

module.exports = function loader(source, map) {
  const callback = this.async();

  const { dir, base } = path.parse(this.resourcePath);
  const definitionPath = path.join(dir, `${base}.d.ts`);

  this.addDependency(definitionPath);

  const exportedValues = extractExports(source);
  const hasExports = Object.keys(exportedValues).length;
  let definitionSource;
  if ( hasExports > 0 )
  {
    let exportedValuesText = `${Object.keys(exportedValues)
      .map(val => `    ${val}: string;`)
      .join(os.EOL)}${os.EOL}`;
    definitionSource = `interface Style${os.EOL}`;
    definitionSource += `{${os.EOL}`;
    definitionSource += exportedValuesText;
    definitionSource += `}${os.EOL}`;
    definitionSource += `declare const esModuleStyle: Style;${os.EOL}`;
    definitionSource += `export default esModuleStyle;${os.EOL}`;
  }
  else
  {
    // TS will treat this as a module when imported as * and no exported values exist
    definitionSource = `declare let emptyCSSModule: void;${
      os.EOL
    }export default emptyCSSModule;${os.EOL}`;
  }


  fs.stat(definitionPath, (err, stats) => {
    if (err && err.code !== 'ENOENT') {
      return callback(err);
    }

    if (stats && stats.isFile()) {
      fs.readFile(definitionPath, 'utf-8', (err, content) => {
        if (err) {
          return callback(err);
        }

        if (definitionSource !== content) {
          return fs.writeFile(
            definitionPath,
            definitionSource,
            'utf-8',
            err => {
              if (err) {
                return callback(err);
              }

              callback(null, source, map);
            }
          );
        }

        callback(null, source, map);
      });
    } else {
      fs.writeFile(definitionPath, definitionSource, 'utf-8', err => {
        if (err) {
          return callback(err);
        }

        callback(null, source, map);
      });
    }
  });
};
