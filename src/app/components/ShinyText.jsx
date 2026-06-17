export function ShinyText({ as: Tag = "span", className = "", children }) {
  return <Tag className={`shiny-text ${className}`.trim()}>{children}</Tag>;
}
