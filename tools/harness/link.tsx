/** In de harness is een link gewoon een anker. */
export default function Link({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) {
  return <a href={href} {...rest}>{children}</a>;
}
