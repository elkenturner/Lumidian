import { type ReactNode, type HTMLAttributes } from 'react';

type ContainerWidth = 'wide' | 'default' | 'content' | 'narrow';

// Named width tiers replace the ad-hoc max-w-2xl..7xl jumble.
// Gutter is identical across all tiers for vertical-edge alignment.
const WIDTH_CLASS: Record<ContainerWidth, string> = {
  wide: 'max-w-[1200px]',     // page chrome: nav, footer, feature grid
  default: 'max-w-[1080px]',  // primary content: hero, models bar
  content: 'max-w-[880px]',   // single-column reading: steps, pricing
  narrow: 'max-w-[680px]',    // tight reading: FAQ, final CTA
};

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  width?: ContainerWidth;
  children: ReactNode;
}

export function Container({ width = 'default', className = '', children, ...rest }: ContainerProps) {
  return (
    <div className={`mx-auto w-full px-4 sm:px-6 lg:px-8 ${WIDTH_CLASS[width]} ${className}`} {...rest}>
      {children}
    </div>
  );
}
