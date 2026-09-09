import fs from "fs";
import path from "path";

// The email templates are plain .html — tsc never emits them, so where they
// land depends on how the app is run:
//   • dev (tsx, cwd = backend/)     → backend/src/templates/emails
//   • prod (node dist/server.js)    → <cwd>/src/templates/emails, shipped by
//                                     the Dockerfile alongside dist/
//   • some builds copy assets into  → dist/templates/emails
// Resolve against every plausible location and use the first that exists so a
// build/layout change can't silently disable templated email again.
const CANDIDATE_DIRS: string[] = [
  path.resolve(process.cwd(), "src", "templates", "emails"),
  path.resolve(process.cwd(), "dist", "templates", "emails"),
  path.resolve(__dirname, "..", "templates", "emails"),
  path.resolve(__dirname, "..", "..", "src", "templates", "emails"),
  path.resolve(__dirname, "..", "..", "templates", "emails"),
];

const TEMPLATES_DIR: string =
  CANDIDATE_DIRS.find((dir) => {
    try {
      return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  }) ?? CANDIDATE_DIRS[0];

const templateCache = new Map<string, string>();

/**
 * Load and cache an email template
 * @param templateName - Name of the template file (without .html)
 * @returns Template content
 */
export function getTemplate(templateName: string): string {
  if (templateCache.has(templateName)) {
    return templateCache.get(templateName) as string;
  }
  
  const filePath = path.join(TEMPLATES_DIR, `${templateName}.html`);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Email template not found: ${templateName}`);
  }
  
  const content = fs.readFileSync(filePath, "utf8");
  templateCache.set(templateName, content);
  return content;
}

/**
 * Simple template renderer using {{variable}} syntax
 * Supports basic conditionals {{#if variable}}...{{/if}}
 * @param template - Template string
 * @param data - Data object for interpolation
 * @returns Rendered template
 */
export function renderTemplate(template: string, data: Record<string, any> = {}): string {
  let result = template;
  
  // Handle {{#if variable}}...{{/if}} conditionals
  result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match: string, key: string, content: string) => {
    return data[key] ? content : "";
  });
  
  // Handle {{variable}} interpolation
  result = result.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (match: string, key: string) => {
    const keys = key.split(".");
    let value: any = data;
    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = value[k];
      } else {
        return "";
      }
    }
    return value !== undefined && value !== null ? String(value) : "";
  });
  
  return result;
}

/**
 * Render an email template with data
 * @param templateName - Template name (without .html)
 * @param data - Data for template interpolation
 * @returns Rendered HTML
 */
export function renderEmail(templateName: string, data: Record<string, any>): string {
  const template = getTemplate(templateName);
  return renderTemplate(template, data);
}

export default { getTemplate, renderTemplate, renderEmail };
