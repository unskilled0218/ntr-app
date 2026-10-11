import { beforeAll } from "vitest";

// jsdom does not implement <dialog>.showModal()/close(). Patch the prototype once for every test
// file (via vitest setupFiles) so any component using a native <dialog> can open and close it.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});
