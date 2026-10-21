// React and the design system come from the classic scripts in index.html; `h` stands in for JSX.
export const React = window.React;
export const F = window.Foreman;
export const h = React.createElement;
export const Fragment = React.Fragment;
export const { useState, useEffect, useRef, useMemo, useCallback } = React;
export const frag = (...children) => h(Fragment, null, ...children);
