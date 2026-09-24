/* Auto-generated from app.js by scripts/extract-pages.mjs.
 * Renderer for the "events" tab.
 * Shared state/helpers are read from app.js (loaded first) via the
 * classic script scope. Registers itself on window.Humana.pages so
 * pageContent() in app.js can dispatch by currentPage.
 */
(function () {
  "use strict";
  function eventsPage() {
    const admin = isAdmin();
    const events = getCompanyEvents();
    const now = Date.now();
    const upcoming = events
      .filter((event) => {
        const end = event.ends_at ? new Date(event.ends_at).getTime() : new Date(event.starts_at).getTime();
        return Number.isFinite(end) && end >= now;
      })
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const past = events
      .filter((event) => {
        const end = event.ends_at ? new Date(event.ends_at).getTime() : new Date(event.starts_at).getTime();
        return Number.isFinite(end) && end < now;
      })
      .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))
      .slice(0, 12);

    const featured = upcoming[0] || null;
    const rest = upcoming.slice(1);

    const editingId = appData.eventEditingId || "";
    const editing = editingId ? events.find((event) => String(event.id) === String(editingId)) : null;
    const defaultStart = editing?.starts_at
      ? eventLocalDateTimeValue(editing.starts_at)
      : eventLocalDateTimeValue(new Date(Date.now() + 60 * 60 * 1000).toISOString());
    const defaultEnd = editing?.ends_at ? eventLocalDateTimeValue(editing.ends_at) : "";

    const tableMissingWarning = appData.companyEventsTableMissing && admin
      ? `<article class="card error-card">
          <p class="error-message">Table <code>company_events</code> introuvable. Redémarrez l'API pour appliquer les migrations.</p>
        </article>`
      : "";

    const renderFeatured = (event) => {
      const meta = eventTypeMeta(event.event_type);
      const countdown = formatCountdown(event.starts_at);
      const author = profileById(event.created_by)?.full_name || "";
      const posterUrl = sanitizeEventPosterUrl(event);
      return `
        <article class="event-hero event-hero--${meta.id}${posterUrl ? " has-poster" : ""}" data-event-open="${event.id}" role="button" tabindex="0" aria-label="Voir le détail de ${escapeHtml(event.title)}">
          ${posterUrl ? `<div class="event-hero__poster" aria-hidden="true"><img src="${escapeHtml(posterUrl)}" alt=""></div>` : ""}
          <button type="button" class="event-hero__expand" data-event-open="${event.id}" aria-label="Agrandir">⤢</button>
          <div class="event-hero__overlay">
            <div class="event-hero__meta">
              <span class="event-type-pill event-type--${meta.id}">${meta.icon} ${meta.label}</span>
              ${countdown ? `<span class="event-hero__countdown">${escapeHtml(countdown)}</span>` : ""}
            </div>
            <h2 class="event-hero__title">${escapeHtml(event.title)}</h2>
            <div class="event-hero__info">
              <span>🗓️ ${escapeHtml(formatEventWhen(event))}</span>
              ${event.location ? `<span>📍 ${escapeHtml(event.location)}</span>` : ""}
              <span>👥 ${escapeHtml(eventVisibilityLabel(event.visibility))}</span>
            </div>
            ${event.description ? `<p class="event-hero__desc">${escapeHtml(event.description)}</p>` : ""}
            <div class="event-hero__footer">
              <span class="event-hero__author">${author ? `Publié par ${escapeHtml(author)}` : ""}</span>
              ${admin ? `
                <div class="event-actions">
                  <button type="button" class="outline-button" data-event-edit="${event.id}">Modifier</button>
                  <button type="button" class="outline-button danger" data-event-delete="${event.id}">Supprimer</button>
                </div>` : ""}
            </div>
          </div>
        </article>`;
    };

    const renderEventCard = (event, options = {}) => {
      const meta = eventTypeMeta(event.event_type);
      const author = profileById(event.created_by)?.full_name || "";
      const canManage = admin;
      const compact = Boolean(options.compact);
      const past = Boolean(options.past);

      if (compact) {
        return `
          <article class="event-row${past ? " event-row--past" : ""}" data-event-open="${event.id}" role="button" tabindex="0" aria-label="Voir le détail de ${escapeHtml(event.title)}">
            ${renderDateBadge(event.starts_at)}
            <div class="event-row__body">
              <div class="event-row__head">
                <span class="event-type-pill event-type--${meta.id}">${meta.icon} ${meta.label}</span>
                <span class="event-row__time">${escapeHtml(formatEventTimeShort(event))}</span>
              </div>
              <h4 class="event-row__title">${escapeHtml(event.title)}</h4>
              ${event.location ? `<span class="event-row__location">📍 ${escapeHtml(event.location)}</span>` : ""}
            </div>
            ${canManage ? `
              <div class="event-row__actions">
                <button type="button" class="icon-button" data-event-edit="${event.id}" title="Modifier" aria-label="Modifier">✎</button>
                <button type="button" class="icon-button danger" data-event-delete="${event.id}" title="Supprimer" aria-label="Supprimer">×</button>
              </div>` : ""}
          </article>`;
      }

      const posterUrl = sanitizeEventPosterUrl(event);
      return `
        <article class="event-card event-card--${meta.id}${past ? " event-card--past" : ""}" data-event-open="${event.id}" role="button" tabindex="0" aria-label="Voir le détail de ${escapeHtml(event.title)}">
          <div class="event-card__media">
            ${posterUrl
              ? `<div class="event-card__poster-wrap">
                  <img class="event-card__poster" src="${escapeHtml(posterUrl)}" alt="Affiche ${escapeHtml(event.title)}" loading="lazy">
                </div>`
              : `<div class="event-card__poster-placeholder" aria-hidden="true"><span>${meta.icon}</span></div>`}
            ${renderDateBadge(event.starts_at)}
            <span class="event-type-pill event-type-pill--floating event-type--${meta.id}">${meta.icon} ${meta.label}</span>
            <span class="event-card__expand" aria-hidden="true">⤢</span>
          </div>
          <div class="event-card__body">
            <h3 class="event-card__title">${escapeHtml(event.title)}</h3>
            <div class="event-card__meta">
              <span>🕒 ${escapeHtml(formatEventTimeShort(event))}</span>
              ${event.location ? `<span>📍 ${escapeHtml(event.location)}</span>` : ""}
            </div>
            ${event.description ? `<p class="event-card__desc">${escapeHtml(event.description)}</p>` : ""}
            <div class="event-card__footer">
              <span class="event-card__author">${author ? escapeHtml(author) : ""}${author && event.visibility !== "all" ? " · " : ""}${event.visibility !== "all" ? escapeHtml(eventVisibilityLabel(event.visibility)) : ""}</span>
              ${canManage ? `
                <div class="event-actions">
                  <button type="button" class="outline-button" data-event-edit="${event.id}">Modifier</button>
                  <button type="button" class="outline-button danger" data-event-delete="${event.id}">Supprimer</button>
                </div>` : ""}
            </div>
          </div>
        </article>`;
    };

    const adminForm = admin
      ? `
        <aside class="events-composer">
          <article class="card events-composer__card">
            <div class="events-composer__head">
              <div>
                <h3>${editing ? "Modifier l'événement" : "Créer un événement"}</h3>
                <p>${editing ? "Ajustez les détails puis enregistrez." : "Diffusez une annonce, une réunion, une célébration…"}</p>
              </div>
              <span class="events-composer__icon" aria-hidden="true">${editing ? "✎" : "＋"}</span>
            </div>
            <form id="event-form" class="events-composer__form" data-event-id="${editing?.id || ""}">
              <label class="field field--wide">
                <span>Titre</span>
                <input type="text" name="title" maxlength="140" value="${escapeHtml(editing?.title || "")}" placeholder="Ex. Réunion mensuelle" required>
              </label>
              <label class="field">
                <span>Type</span>
                <select name="event_type">
                  ${EVENT_TYPES.map((type) => {
                    const selected = editing?.event_type === type.id ? " selected" : "";
                    return `<option value="${type.id}"${selected}>${type.icon} ${type.label}</option>`;
                  }).join("")}
                </select>
              </label>
              <label class="field">
                <span>Visibilité</span>
                <select name="visibility">
                  ${EVENT_VISIBILITIES.map((vis) => {
                    const selected = (editing?.visibility || "all") === vis.id ? " selected" : "";
                    return `<option value="${vis.id}"${selected}>${vis.label}</option>`;
                  }).join("")}
                </select>
              </label>
              <label class="field field--wide event-checkbox">
                <input type="checkbox" name="all_day" ${editing?.all_day ? "checked" : ""}>
                <span>Toute la journée</span>
              </label>
              <label class="field">
                <span>Début</span>
                <input type="datetime-local" name="starts_at" value="${defaultStart}" required>
              </label>
              <label class="field">
                <span>Fin <em>(facultatif)</em></span>
                <input type="datetime-local" name="ends_at" value="${defaultEnd}">
              </label>
              <label class="field field--wide">
                <span>Lieu <em>(facultatif)</em></span>
                <input type="text" name="location" maxlength="180" value="${escapeHtml(editing?.location || "")}" placeholder="Ex. Salle Zenith · Visio Teams">
              </label>
              <label class="field field--wide">
                <span>Description</span>
                <textarea name="description" rows="4" maxlength="2000" placeholder="Détails, agenda, lien de visio, etc.">${escapeHtml(editing?.description || "")}</textarea>
              </label>
              <label class="field field--wide event-poster-field">
                <span>Affiche <em>(JPG, PNG, WEBP, GIF · max 5 Mo)</em></span>
                <input type="file" name="poster" accept="image/jpeg,image/png,image/webp,image/gif">
              </label>
            ${sanitizeEventPosterUrl(editing) ? `
              <div class="field field--wide event-poster-preview">
                <img src="${escapeHtml(sanitizeEventPosterUrl(editing))}" alt="Affiche actuelle">
                <label class="event-checkbox">
                  <input type="checkbox" name="remove_poster">
                  <span>Supprimer l'affiche actuelle</span>
                </label>
              </div>` : ""}
              <div class="events-composer__actions">
                ${editing ? `<button type="button" class="outline-button" id="event-cancel">Annuler</button>` : ""}
                <button type="submit" class="primary">${editing ? "Enregistrer" : "Publier l'événement"}</button>
              </div>
            </form>
          </article>
        </aside>`
      : "";

    const heroBlock = featured
      ? renderFeatured(featured)
      : `<article class="event-hero event-hero--empty">
          <div class="event-hero__overlay">
            <span class="event-type-pill event-type--general">📣 Aucun événement</span>
            <h2 class="event-hero__title">${admin ? "Rien de prévu pour l'instant" : "Aucune annonce à venir"}</h2>
            <p class="event-hero__desc">${admin ? "Utilisez le formulaire pour publier votre première annonce à toute l'équipe." : "Les administrateurs partageront ici les prochains temps forts."}</p>
          </div>
        </article>`;

    const upcomingGrid = rest.length
      ? `
        <section class="events-section">
          <div class="events-section__head">
            <h3>Prochains rendez-vous</h3>
            <span class="events-section__count">${rest.length} événement${rest.length > 1 ? "s" : ""}</span>
          </div>
          <div class="event-grid">
            ${rest.map((event) => renderEventCard(event)).join("")}
          </div>
        </section>`
      : "";

    const pastBlock = past.length
      ? `
        <section class="events-section events-section--past">
          <div class="events-section__head">
            <h3>Historique récent</h3>
            <span class="events-section__count">${past.length}</span>
          </div>
          <div class="event-row-list">
            ${past.map((event) => renderEventCard(event, { compact: true, past: true })).join("")}
          </div>
        </section>`
      : "";

    const stats = `
      <div class="events-stats">
        <div class="events-stat"><strong>${upcoming.length}</strong><span>À venir</span></div>
        <div class="events-stat"><strong>${featured ? formatCountdown(featured.starts_at) : "—"}</strong><span>Prochain</span></div>
        <div class="events-stat"><strong>${past.length}</strong><span>Passés (30j)</span></div>
      </div>`;

    return `
      ${tableMissingWarning}
      <div class="events-page">
        <div class="events-main">
          ${stats}
          ${heroBlock}
          ${upcomingGrid}
          ${pastBlock}
        </div>
        ${adminForm}
      </div>
      ${renderEventDetailOverlay(events, admin)}`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["events"] = eventsPage;
})();
