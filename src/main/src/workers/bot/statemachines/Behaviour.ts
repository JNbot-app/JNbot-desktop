


interface Behaviour {
  name: string; // Name of the behaviour
  shouldTrigger: () => boolean; // Function that returns true if the behaviour should be executed
  action: () => void | Promise<void>; // Action to be executed
  once?: boolean; // If the behaviour should only be executed once (default false)
  ignore?: boolean; // If the behaviour should be ignored (default false)
}
