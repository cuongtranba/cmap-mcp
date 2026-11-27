/** Markdown imported `with { type: "text" }`: the bundler inlines the file as a string. */
declare module "*.md" {
  const text: string;
  export default text;
}
