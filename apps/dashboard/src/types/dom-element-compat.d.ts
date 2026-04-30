interface Element {
  before(...nodes: Array<Node | string>): void;
  after(...nodes: Array<Node | string>): void;
  prepend(...nodes: Array<Node | string>): void;
  append(...nodes: Array<Node | string>): void;
}
