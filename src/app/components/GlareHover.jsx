export function GlareHover({ children, className = "", as: Tag = "div", ...props }) {
  return (
    <Tag className={`glare-hover ${className}`.trim()} {...props}>
      {children}
    </Tag>
  );
}
