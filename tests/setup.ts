import { afterEach } from 'vitest';

// jsdom does not implement HTMLDialogElement.showModal()/close().
const dialogPrototype = Object.getPrototypeOf(document.createElement('dialog')) as HTMLElement & {
  showModal?: () => void;
  close?: () => void;
};
if (typeof dialogPrototype.showModal !== 'function') {
  dialogPrototype.showModal = function showModal(this: HTMLElement) {
    this.setAttribute('open', '');
  };
  dialogPrototype.close = function close(this: HTMLElement) {
    this.removeAttribute('open');
  };
}

afterEach(() => {
  localStorage.clear();
});
