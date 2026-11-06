import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export default function ScrollArea({ children, className = '', style, ...props }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ top: true, bottom: true });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop <= 2;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 2;
    setEdges((current) => (current.top === top && current.bottom === bottom ? current : { top, bottom }));
  }, []);

  useLayoutEffect(() => {
    update();
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);

  return (
    <div
      ref={ref}
      className={`scroll-fade ${className}`}
      style={{
        '--fade-top': edges.top ? '0px' : '24px',
        '--fade-bottom': edges.bottom ? '0px' : '24px',
        ...style,
      }}
      onScroll={update}
      {...props}
    >
      {children}
    </div>
  );
}
