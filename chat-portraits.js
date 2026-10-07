/* Shared local roll-module patch. Synced by _release-audit/sync-chat-portraits.py.
 * D&D6 compact cards suppress avatars; restore only their standalone header.
 */
(() => {
  const key = Symbol.for("foundry-local.chat-portraits.v1");
  if (Hooks[key]) return;
  Object.defineProperty(Hooks, key, { value: true });

  Hooks.on("dnd5e.renderChatMessage", (message, element) => {
    const html = element?.nodeType === 1 ? element : element?.[0];
    // Never promote summaries or hidden/blind content into visible chat cards.
    if (!html?.matches(".chat-message") || html.hidden || !message.isContentVisible) return;
    const sender = html.querySelector(":scope > .message-header > .message-sender");
    if (!sender) return;
    const actor = typeof message.getAssociatedActor === "function"
      ? message.getAssociatedActor() : message.speakerActor;
    if (!actor) return;

    const doc = html.ownerDocument;
    if (!doc.getElementById("local-chat-portraits-style")) {
      const style = doc.createElement("style");
      style.id = "local-chat-portraits-style";
      style.textContent = `
        .chat-message.local-chat-portrait > .message-header {
          display: flex; flex-wrap: wrap; align-items: center;
        }
        .chat-message.local-chat-portrait > .message-header > .message-sender {
          display: flex; flex: 1 1 0; align-items: center; gap: .75rem;
          white-space: normal; min-width: 0; font-variant: normal;
        }
        .chat-message.local-chat-portrait > .message-header > .message-metadata {
          flex: 0 0 auto;
        }
        .chat-message.local-chat-portrait > .message-header > :is(.flavor-text, .whisper-to) {
          flex: 0 0 100%; min-width: 0; order: 1; white-space: normal;
          overflow-wrap: anywhere;
        }
        .chat-message.local-chat-portrait > .message-header > .message-sender > .avatar {
          display: grid; place-content: center; flex: 0 0 38px; width: 38px; height: 38px;
        }
        .chat-message.local-chat-portrait > .message-header > .message-sender > .avatar > :is(img, video) {
          display: block; width: 38px; height: 38px; max-width: none; border: none;
          border-radius: 4px; object-fit: cover; object-position: top;
        }
        .chat-message.local-chat-portrait > .message-header > .message-sender > .avatar.token > :is(img, video) {
          object-fit: contain; object-position: center;
        }
        .chat-message.local-chat-portrait > .message-header > .message-sender > .name-stacked {
          display: flex; flex: 1; min-width: 0; min-height: 38px;
          flex-direction: column; justify-content: center; line-height: normal;
        }
        .chat-message.local-chat-portrait > .message-header > .message-sender > .name-stacked > .title {
          font-family: var(--dnd5e-font-roboto-slab); font-size: var(--font-size-16);
          font-weight: bold; color: var(--color-text-primary); overflow-wrap: anywhere;
        }
        .chat-message.local-chat-portrait > .message-header > .message-sender > .name-stacked > .subtitle {
          font-family: var(--dnd5e-font-roboto); font-size: var(--font-size-11);
          font-weight: normal; color: var(--color-text-secondary);
        }
      `;
      doc.head.append(style);
    }
    html.classList.add("local-chat-portrait");
    // Existing native portraits keep their artwork choice and native listeners.
    if (sender.querySelector(":scope > .avatar")) return;

    const alias = sender.textContent.trim() || message.alias || actor.name;
    const avatar = doc.createElement("span");
    avatar.className = "avatar";
    const src = actor.img || message.author?.avatar || CONST.DEFAULT_TOKEN;
    const media = doc.createElement(foundry.helpers.media.VideoHelper.hasVideoExtension(src) ? "video" : "img");
    media.src = src;
    if (media.tagName === "VIDEO") {
      media.autoplay = true;
      media.muted = true;
      media.loop = true;
      media.playsInline = true;
      media.setAttribute("aria-label", alias);
    } else media.alt = alias;
    avatar.append(media);

    const name = doc.createElement("span");
    name.className = "name-stacked";
    const title = doc.createElement("span");
    title.className = "title";
    title.textContent = alias;
    const subtitle = doc.createElement("span");
    subtitle.className = "subtitle";
    subtitle.textContent = message.author?.name !== alias ? (message.author?.name ?? "") : "";
    name.append(title, subtitle);
    // Keep sender element/listeners, timestamp, whisper recipients and roll body intact.
    sender.replaceChildren(avatar, name);
  });
})();
