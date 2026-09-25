/** A writable reactive cell, standing in for the layout's `data` prop. */
export const cell = <T>(initial: T): { current: T } => {
  let current = $state.raw(initial);

  return {
    get current() { return current; },
    set current(value: T) { current = value; },
  };
};
