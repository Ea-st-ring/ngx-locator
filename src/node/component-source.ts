import ts from 'typescript';
import path from 'path';

export type ComponentSourceInfo = {
  className: string;
  /** Absolute path of the component .ts file. */
  filePath: string;
  /** Absolute path of the external template, when the component uses templateUrl. */
  templateUrl?: string;
  /** 1-based line of the class name. */
  line: number;
  /** The decorator's `selector`, used to tell same-named components apart. */
  selector?: string;
};

function extractStringProperty(
  node: ts.ObjectLiteralExpression,
  name: 'templateUrl' | 'selector',
): string | undefined {
  for (const prop of node.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === name) {
      const initializer = prop.initializer;
      if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
        return initializer.text;
      }
    }
  }
  return undefined;
}

function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  const modernTs = ts as typeof ts & {
    canHaveDecorators?: (node: ts.Node) => boolean;
    getDecorators?: (node: ts.Node) => readonly ts.Decorator[] | undefined;
  };

  if (modernTs.canHaveDecorators?.(node) && modernTs.getDecorators) {
    return modernTs.getDecorators(node) ?? [];
  }

  const legacyNode = node as ts.Node & {
    decorators?: ts.NodeArray<ts.Decorator>;
    modifiers?: ts.NodeArray<ts.ModifierLike>;
  };
  return legacyNode.decorators ?? legacyNode.modifiers?.filter(ts.isDecorator) ?? [];
}

function findComponentDecorator(node: ts.ClassDeclaration): ts.Decorator | undefined {
  for (const decorator of getDecorators(node)) {
    const expr = decorator.expression;
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
      if (expr.expression.text === 'Component') {
        return decorator;
      }
    }
  }
  return undefined;
}

/** Finds every `@Component` class in a source file. `filePath` must be absolute. */
export function parseComponentSource(filePath: string, sourceCode: string): ComponentSourceInfo[] {
  const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);
  const components: ComponentSourceInfo[] = [];

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node) && node.name) {
      const componentDecorator = findComponentDecorator(node);
      if (componentDecorator) {
        const expr = componentDecorator.expression as ts.CallExpression;
        const firstArg = expr.arguments[0];

        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          const templateUrl = extractStringProperty(firstArg, 'templateUrl');
          const selector = extractStringProperty(firstArg, 'selector');
          components.push({
            className: node.name.text,
            filePath,
            templateUrl: templateUrl
              ? path.resolve(path.dirname(filePath), templateUrl)
              : undefined,
            line: sourceFile.getLineAndCharacterOfPosition(node.name.getStart(sourceFile)).line + 1,
            ...(selector ? { selector } : {}),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return components;
}
