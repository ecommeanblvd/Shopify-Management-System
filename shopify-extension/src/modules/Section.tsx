import type { ComponentChildren } from 'preact';

/**
 * Shared chrome for every account module: an `s-section` with the configured
 * title and an optional PNG icon (no background) supplied from the SMS config.
 * Keeps the luxury-minimal tone consistent across modules.
 */
export function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string | null;
  children: ComponentChildren;
}) {
  return (
    <s-section heading={title}>
      <s-stack direction="block" gap="base">
        {icon ? <s-image src={icon} alt="" inlineSize="40px" /> : null}
        {children}
      </s-stack>
    </s-section>
  );
}
