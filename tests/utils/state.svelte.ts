/** A writable reactive cell, standing in for the layout's `data` prop. */
export const cell = <T>(initial: T): { current: T } => {
  let current = $state.raw(initial);

  return {
    get current() { return current; },
    set current(value: T) { current = value; },
  };
};

/** A cell in deep state, as an app may hold `data`: it proxies plain objects. */
export const deep = <T>(initial: T): { current: T } => {
  let current = $state(initial);

  return {
    get current() { return current; },
    set current(value: T) { current = value; },
  };
};
