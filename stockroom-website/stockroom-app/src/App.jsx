import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  X,
  Pencil,
  Trash2,
  Search,
  ChevronDown,
  Check,
  ImageOff,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  EMPTY_PAIR,
  filterItems,
  genId,
  formatPrice,
  formatRating,
  getAllTags,
  getCollectionStats,
  getPriceNarrative,
  getRefreshCandidates,
  describeRefreshCost,
  describeRefreshDetail,
  describeLastChecked,
  sortItems,
  SORTS,
  normalizeProductImage,
  configureImageProxy,
  pairFieldsFromSearchResult,
  toStoredPair,
} from '@stockroom/shared';

const LEGACY_STORAGE_KEY = 'sneaker-stockroom-items';
// In development the API runs on its own port; in production the same server
// serves this page and the API, so requests stay on the page's own origin.
const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:8787' : '');
const AUTH_API = `${API_BASE}/api/auth`;
const TOKEN_KEY = 'stockroom-owner-token';
const SEARCH_API = `${API_BASE}/api/search`;
const COLLECTION_API = `${API_BASE}/api/collection`;
const PRICES_API = `${API_BASE}/api/prices`;
const HISTORY_API = `${API_BASE}/api/price-history`;
const UPLOAD_API = `${API_BASE}/api/images/upload`;
const FLIP_API = `${API_BASE}/api/images/flip`;

// Photography from suppliers with no imgix in front of them is normalized by
// our own server. Telling the shared image layer where that server is has to
// happen before the first render, since every <Photo> reads it.
configureImageProxy(API_BASE || window.location.origin);

// The deployed copy is public and read-only. Writes need the owner token,
// which lives only in the owner's browser and goes out as a bearer header.
// Reads never need it, so visitors see everything and change nothing.
function ownerToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function apiFetch(url, options = {}) {
  const token = ownerToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}

function OwnerBar({ canEdit, authRequired, onSignIn, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  // A server without ADMIN_TOKEN (local development) lets everyone edit, so
  // there is nothing to sign in to and the bar stays out of the way.
  if (!authRequired) return null;

  const submit = async (e) => {
    e.preventDefault();
    const ok = await onSignIn(draft.trim());
    if (ok) {
      setOpen(false);
      setDraft('');
      setError('');
    } else {
      setError('That token was not accepted.');
    }
  };

  return (
    <footer className="sd-owner">
      {canEdit ? (
        <>
          <span>Signed in as owner. Changes save to the live collection.</span>
          <button type="button" className="sd-owner-link" onClick={onSignOut}>Sign out</button>
        </>
      ) : open ? (
        <form className="sd-owner-form" onSubmit={submit}>
          <input
            type="password"
            autoFocus
            placeholder="Owner token"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Owner token"
          />
          <button type="submit" className="sd-owner-link">Sign in</button>
          <button type="button" className="sd-owner-link" onClick={() => setOpen(false)}>Cancel</button>
          {error && <span className="sd-owner-error">{error}</span>}
        </form>
      ) : (
        <>
          <span>A read-only view of Devin's collection.</span>
          <button type="button" className="sd-owner-link" onClick={() => setOpen(true)}>Owner sign-in</button>
        </>
      )}
    </footer>
  );
}

const emptyForm = EMPTY_PAIR;

// A product photo, rendered as a cutout rather than a thumbnail in a tile.
// The blend lives here on the wrapper and never on the <img>: multiply and an
// animating filter on the same element makes Safari flash one unblended frame
// when it tears the compositing layer down. The white box baked into every
// StockX asset dissolves into the paper ground behind it.
function Photo({ src, alt, onError, onClick, empty, className = '' }) {
  return (
    <div
      className={`sd-photo ${className}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick(e);
        }
      }}
    >
      {src ? (
        <img src={src} alt={alt} draggable={false} onError={onError} />
      ) : (
        <div className="sd-photo-empty">
          <ImageOff size={18} />
          {empty}
        </div>
      )}
    </div>
  );
}

// A sort control that belongs to this page rather than to macOS.
//
// A native <select> renders its control AND its menu with the operating
// system's chrome, which no amount of CSS can reach -- so it is rebuilt here
// as a button plus a listbox. Keyboard behaviour is implemented explicitly
// because that is what a native select gives you for free: arrows move,
// Enter/Space commit, Escape closes, Tab or an outside click dismisses.
function SortMenu({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const ids = Object.keys(options);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, ids.indexOf(value)));
    const onDocDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  const commit = (id) => {
    onChange(id);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % ids.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + ids.length) % ids.length); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(ids.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); commit(ids[active]); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className="sd-sort" ref={wrapRef}>
      <span className="sd-sort-label" id="sd-sort-label">Sort</span>
      <div className="sd-sort-control">
        <button
          type="button"
          className={`sd-sort-trigger ${open ? 'is-open' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby="sd-sort-label"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onKeyDown}
        >
          {options[value].label}
          <ChevronDown size={13} aria-hidden="true" />
        </button>
        {open && (
          <ul className="sd-sort-menu" role="listbox" aria-labelledby="sd-sort-label" tabIndex={-1}>
            {ids.map((id, i) => (
              <li key={id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={id === value}
                  className={`sd-sort-option ${id === value ? 'is-selected' : ''} ${i === active ? 'is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(id)}
                >
                  {options[id].label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// A plate: cutout, name, price. Three elements and nothing else.
//
// This replaces the card, and with it the four signals that carried no
// information. Status is no longer stamped, dotted or badged -- it is carried
// by the treatment of the photograph itself (full colour when owned, held
// back when wanted), which is why the stamp and the status dot are gone.
// Size and notes moved to the detail view; tags moved to the filter bar.
// Edit and remove live in the detail view rather than on every plate.
function Plate({
  item,
  openDetail,
  brokenImages,
  setBrokenImages,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOverCard,
  onDropCard,
  onDragEnd,
  canEdit,
}) {
  const movement = getPriceNarrative(item);

  return (
    // A plain <article>, not a motion component. framer-motion's entrance
    // animation left plates stranded at opacity:0 -- with 95 of them each
    // carrying their own staggered tween, the grid would render invisible and
    // every computed style downstream of it froze with them. It is the third
    // failure this library has caused here (exit animations never resolving,
    // the register freezing on tab change, now this), and a near-zero-motion
    // design does not need it. Plates simply render.
    <article
      className={`sd-plate ${item.status} ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(item.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverCard(item.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropCard(item.id);
      }}
      onDragEnd={onDragEnd}
    >
      <Photo
        className="sd-plate-photo"
        src={item.imageUrl && !brokenImages.has(item.id) ? normalizeProductImage(item.imageUrl) : null}
        alt={`${item.brand} ${item.model} ${item.colorway}`}
        empty="No photo"
        onError={() => setBrokenImages((prev) => new Set(prev).add(item.id))}
        onClick={(e) => openDetail(item, e.currentTarget)}
      />
      <div className="sd-plate-caption">
        <p className="sd-brand">{item.brand}</p>
        <h3 className="sd-model">{item.model}</h3>
        <p className="sd-colorway">{item.colorway || '\u00A0'}</p>
        <p className="sd-spec">
          <span className="sd-spec-price">{formatPrice(item.price)}</span>
          <span className="sd-spec-rule" />
          <span className="sd-spec-size">{item.size || '—'}</span>
        </p>
        <p className={`sd-move ${movement.flag ? 'flagged' : ''}`}>{movement.text}</p>
      </div>
    </article>
  );
}

// Chip-style tag entry. Typing suggests already-used tags so a second
// "Basketball" reuses the first instead of forking into a near-duplicate
// like "basketball" — the whole point of skipping a fixed preset list.
function TagInput({ value, onChange, suggestions }) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);

  const matches = draft.trim()
    ? suggestions.filter(
        (s) => s.toLowerCase().includes(draft.trim().toLowerCase()) && !value.includes(s)
      )
    : suggestions.filter((s) => !value.includes(s));

  const commitTag = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const existing = suggestions.find((s) => s.toLowerCase() === trimmed.toLowerCase());
    const tag = existing || trimmed;
    if (!value.includes(tag)) onChange([...value, tag]);
    setDraft('');
  };

  const removeTag = (tag) => onChange(value.filter((t) => t !== tag));

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitTag(draft);
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  return (
    <div className="sd-taginput">
      <div className="sd-taginput-box" onClick={() => inputRef.current?.focus()}>
        {value.map((tag) => (
          <span className="sd-taginput-chip" key={tag}>
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              aria-label={`Remove ${tag}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Leaving the field (clicking Save, tabbing away, clicking
            // elsewhere) commits whatever's still typed — otherwise a tag
            // typed without pressing Enter/comma first silently vanishes.
            if (draft.trim()) commitTag(draft);
            setTimeout(() => setFocused(false), 120);
          }}
          placeholder={value.length === 0 ? 'Basketball, Lifestyle, Cleats…' : ''}
        />
      </div>
      {focused && matches.length > 0 && (
        <ul className="sd-taginput-suggestions">
          {matches.slice(0, 8).map((s) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => {
                  // Commit on mousedown, not click: mousedown always fires
                  // before blur, so this can never race against the
                  // input's onBlur auto-commit (which would otherwise be
                  // free to fire first in some browsers and clear the
                  // draft via a stale value snapshot before this runs).
                  e.preventDefault();
                  commitTag(s);
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The card's photo "grows" from wherever it was clicked into a full detail
// view — the from-rect is captured at click time (see openDetail) and the
// panel animates its own position/size from that rect to a centered one, so
// it reads as the pair lifting out of the grid rather than a modal popping
// up out of nowhere.
// Price observations, plotted. Most pairs currently hold a single datapoint --
// history only began recording when the refresh route was restored -- so this
// has to read honestly at n=1 rather than pretending to be a trend.
function PriceHistory({ series, basis }) {
  if (!series || series.length === 0) {
    return <p className="sd-history-empty">No observations yet. Refresh prices to start a record.</p>;
  }

  const fmt = (t) =>
    new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  if (series.length === 1) {
    const only = series[0];
    return (
      <p className="sd-history-single">
        <span className="sd-history-dot" aria-hidden="true" />
        One observation — ${Math.round(only.price).toLocaleString()} on {fmt(only.timestamp)}
      </p>
    );
  }

  const W = 460;
  const H = 64;
  const prices = series.map((p) => p.price);
  const lo = Math.min(...prices, basis || Infinity);
  const hi = Math.max(...prices, basis || -Infinity);
  const span = hi - lo || 1;
  const x = (i) => (i / (series.length - 1)) * W;
  const y = (v) => H - ((v - lo) / span) * H;
  const points = series.map((p, i) => `${x(i)},${y(p.price)}`).join(' ');
  const last = series[series.length - 1];

  return (
    <figure className="sd-history">
      <svg viewBox={`0 0 ${W} ${H}`} className="sd-history-chart" role="img"
        aria-label={`Price history, ${series.length} observations, latest $${Math.round(last.price)}`}>
        {typeof basis === 'number' && basis > 0 && (
          <line x1="0" x2={W} y1={y(basis)} y2={y(basis)} className="sd-history-basis" />
        )}
        <polyline points={points} className="sd-history-line" />
        <circle cx={x(series.length - 1)} cy={y(last.price)} r="3.5" className="sd-history-end" />
      </svg>
      <figcaption className="sd-history-caption">
        <span>{fmt(series[0].timestamp)}</span>
        <span>{series.length} observations</span>
        <span>{fmt(last.timestamp)}</span>
      </figcaption>
    </figure>
  );
}

// Search-first add.
//
// Every one of the 95 records in this collection arrived through KicksDB
// search, notes have never once been used, and 90% of pairs share a size.
// The old flow put a seven-field form between the search result and the
// collection anyway. Here a result IS the add: one click files it, the search
// stays open so a run of colourways can be added in sequence, and the only
// thing worth typing -- the price -- is offered afterwards on the row that
// was just added.
//
// Target prices are deliberately NOT prefilled from the market. The wishlist's
// targets are round numbers ($150, $250, $300) sitting well under the median
// market price of $382; they are a decision, not an observation.
function AddPanel({
  open,
  register,
  defaultSize,
  results,
  searchTerm,
  setSearchTerm,
  searchLoading,
  searchError,
  onAdd,
  onSetPrice,
  added,
  onUndo,
  onManual,
  onClose,
}) {
  const [status, setStatus] = useState(register === 'want' ? 'want' : 'owned');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setStatus(register === 'want' ? 'want' : 'owned');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open, register]);

  if (!open) return null;

  return (
    <motion.aside
      className="sd-add-panel"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 32 }}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="sd-add-head">
        <h2>Add pairs</h2>
        <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>

      <div className="sd-add-register">
        {[
          { id: 'owned', label: 'To Holdings' },
          { id: 'want', label: 'To Acquisitions' },
        ].map((r) => (
          <button
            key={r.id}
            type="button"
            className={`sd-add-register-btn ${status === r.id ? 'active' : ''}`}
            onClick={() => setStatus(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="sd-add-search">
        <Search size={15} />
        <input
          ref={inputRef}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search KicksDB — model name works best"
          autoComplete="off"
        />
        {searchTerm && (
          <button type="button" onClick={() => setSearchTerm('')} aria-label="Clear"><X size={13} /></button>
        )}
      </div>

      {added.length > 0 && (
        <div className="sd-added">
          <h3 className="sd-add-heading">Added this session</h3>
          {added.map((a) => (
            <div className="sd-added-row" key={a.id}>
              <span className="sd-added-name">
                <b>{a.model}</b> {a.colorway}
              </span>
              <label className="sd-added-price">
                <span>{a.status === 'owned' ? 'Paid' : 'Target'}</span>
                <input
                  value={a.price}
                  placeholder="—"
                  inputMode="decimal"
                  onChange={(e) => onSetPrice(a.id, e.target.value)}
                />
              </label>
              <button type="button" className="sd-added-undo" onClick={() => onUndo(a.id)}>Undo</button>
            </div>
          ))}
        </div>
      )}

      <div className="sd-add-results">
        {searchLoading && <p className="sd-add-note">Searching…</p>}
        {!searchLoading && searchError && <p className="sd-add-error">{searchError}</p>}
        {!searchLoading && !searchError && !searchTerm.trim() && (
          <p className="sd-add-note">
            Type a model name — “kobe 6”, “book 1” — and every colourway KicksDB has for it
            appears here. Clicking one files it straight into {status === 'owned' ? 'Holdings' : 'Acquisitions'}.
          </p>
        )}
        {!searchLoading && !searchError && searchTerm.trim() && results.length === 0 && (
          <p className="sd-add-note">No matches. Try the model without the colourway.</p>
        )}
        {!searchLoading && results.length > 0 && (
          <ul className="sd-add-grid">
            {results.map((r, i) => (
              <li key={r.id || `${r.sku}-${i}`}>
                <button type="button" className="sd-add-result" onClick={() => onAdd(r, status)}>
                  <span className="sd-add-cut">
                    {r.imageUrl
                      ? <img src={normalizeProductImage(r.imageUrl, { width: 300 })} alt="" loading="lazy" />
                      : <span className="sd-add-noimg"><ImageOff size={16} /></span>}
                  </span>
                  <span className="sd-add-brand">{r.brand}</span>
                  <span className="sd-add-model">{r.colorway || r.model}</span>
                  <span className="sd-add-sub">{r.model}</span>
                  {typeof r.marketPrice === 'number' && r.marketPrice > 0 && (
                    <span className="sd-add-market">${Math.round(r.marketPrice).toLocaleString()}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="sd-add-foot">
        <span className="sd-add-foot-note">Size defaults to {defaultSize || '—'}</span>
        <button type="button" className="sd-cancel-btn" onClick={onManual}>Add manually</button>
      </footer>
    </motion.aside>
  );
}

// Phones shoot photographs far larger than the 900px the shelf keeps, and a
// base64 body inflates the bytes another third on top -- a photo straight off a
// camera roll came back as a 413 from the body parser. Re-encoding in the
// browser first keeps the request small, applies EXIF rotation while the pixels
// are still in a canvas, and turns anything the browser can decode into a plain
// JPEG the server is guaranteed to understand.
const MAX_UPLOAD_EDGE = 2000;
const REENCODE_OVER_BYTES = 3 * 1024 * 1024;
const SERVER_SAFE_TYPES = /^image\/(jpeg|png|webp|gif)$/;
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif|avif)$/i;

// A .HEIC dragged into Chrome arrives with an empty `type`, so judging by MIME
// type alone turned away the one format most likely to come off a phone.
function looksLikeImage(file) {
  return file.type ? file.type.startsWith('image/') : IMAGE_EXTENSIONS.test(file.name || '');
}

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });

async function reencodeToJpeg(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  } finally {
    bitmap.close?.();
  }
}

// Oversized, or a format the server may not decode: try the browser's decoder
// first. Chrome cannot read HEIC either, so a failure here is not fatal -- the
// original bytes still go up, and the server has a fallback for that case.
async function toUploadDataUrl(file) {
  if (file.size > REENCODE_OVER_BYTES || !SERVER_SAFE_TYPES.test(file.type)) {
    try {
      return await reencodeToJpeg(file);
    } catch {
      /* fall through and send what we were given */
    }
  }
  return readAsDataUrl(file);
}

// Drop a photograph in instead of hunting for a URL.
//
// The pairs this app cannot find in either catalogue are exactly the ones with
// no convenient image link -- the previous answer was to paste a supplier URL
// and accept whatever framing and orientation it came with. Anything dropped
// here goes through the same trim and resize as a catalogue photo, so a
// hand-added pair sits on the shelf looking like the rest.
// The id out of an uploaded photo's url, or null for a pasted link -- only our
// own stored images can be flipped after the fact.
function uploadedIdFrom(url) {
  const match = /\/api\/images\/uploaded\/([a-z0-9-]+)/i.exec(url || '');
  return match ? match[1] : null;
}

function PhotoDrop({ value, onUploaded, uploadApi, flipApi }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [mirror, setMirror] = useState(false);
  const inputRef = useRef(null);

  const upload = async (file, flip) => {
    if (!file) return;
    if (!looksLikeImage(file)) {
      setError('That is not an image file.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const dataUrl = await toUploadDataUrl(file);
      const res = await apiFetch(uploadApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, filename: file.name, mirror: flip }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || body.error || `status ${res.status}`);
      onUploaded(body.url);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  // Ticking the box with a photo already on screen flips THAT photo, rather
  // than silently arming a preference for the next upload -- which is what it
  // used to do, and which read as the toggle being broken.
  const toggleMirror = async (next) => {
    setMirror(next);
    const id = uploadedIdFrom(value);
    if (!id) return;

    setBusy(true);
    setError('');
    try {
      const res = await apiFetch(flipApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || body.error || `status ${res.status}`);
      onUploaded(body.url);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sd-drop-wrap">
      <div
        className={`sd-drop ${dragging ? 'is-over' : ''} ${busy ? 'is-busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files?.[0], mirror);
        }}
        // preventDefault, because this zone sits inside the form's <label> and
        // the hidden file input is that label's labelled control: without it a
        // single click reaches the input twice -- once from here, once from the
        // label's own activation -- and a browser asked for the file dialog
        // twice in one gesture cancels it. Clicking did nothing at all.
        onClick={(e) => { e.preventDefault(); inputRef.current?.click(); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          // This input sits inside the zone that opens it, so without stopping
          // the bubble the programmatic click reaches the zone's own handler,
          // which asks for the picker a second time -- and the browser cancels
          // the dialog it was already opening. Clicking the zone did nothing.
          onClick={(e) => e.stopPropagation()}
          // Clearing the value first: picking the same filename again is a real
          // move (the re-cropped version of the photo you just tried), and
          // `change` does not fire when the value has not changed.
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = '';
            upload(picked, mirror);
          }}
        />
        {busy
          ? 'Trimming…'
          : value
          ? 'Photo set — drop another to replace'
          : 'Drop a photo here, or click to choose'}
      </div>
      <label className="sd-drop-flip">
        <input
          type="checkbox"
          checked={mirror}
          disabled={busy}
          onChange={(e) => toggleMirror(e.target.checked)}
        />
        {/* Off by default: an arbitrary photo has no known convention, unlike
            a supplier whose whole catalogue faces one way. Once a photo IS on
            screen the box is no longer a preference for later, so it says what
            it will do to the thing you are looking at. */}
        {value ? 'Flip this photo' : 'Flip to face right'}
      </label>
      {error && <p className="sd-drop-error">{error}</p>}
    </div>
  );
}

// The detail view as a specimen page: the pair full-bleed at the top, then
// everything known about it as a plain ruled table. It still grows out of the
// plate it was opened from.
//
// It is also a page in a sequence rather than a dead end. The chevrons (and
// the left/right keys, bound by the parent) step through the register that is
// showing behind it, so reading five colourways in a row no longer means
// closing back out to the grid between each one. The panel itself stays
// mounted across a step -- only the photograph and the table are re-keyed and
// slid in -- so the frame holds still and it reads as turning a page rather
// than as opening a second modal.
function DetailPanel({
  detail,
  position,
  hasPrev,
  hasNext,
  onStep,
  onClose,
  onEdit,
  onDelete,
  onAcquire,
  onRefreshOne,
  canEdit,
}) {
  const { item, rect, dir = 0 } = detail;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [buying, setBuying] = useState(false);
  const [paidDraft, setPaidDraft] = useState('');
  const [series, setSeries] = useState(null);
  const movement = getPriceNarrative(item);
  const wanted = item.status === 'want';

  // Stepping keeps this component mounted, so the transient states it owns
  // have to be cleared by hand -- otherwise a half-finished "Remove" or
  // "I bought this" would carry over onto the next pair and act on that one.
  useEffect(() => {
    setConfirmingDelete(false);
    setBuying(false);
    setPaidDraft('');
  }, [item.id]);

  useEffect(() => {
    // Blank first: without this the previous pair's history stays on screen
    // for the length of the fetch, reading as if it belonged to this one.
    setSeries(null);
    if (!item.kicksId) { setSeries([]); return; }
    let live = true;
    (async () => {
      try {
        const res = await apiFetch(`${HISTORY_API}?id=${encodeURIComponent(item.kicksId)}`);
        const data = await res.json();
        if (live) setSeries(data.history?.[item.kicksId] ?? []);
      } catch {
        if (live) setSeries([]);
      }
    })();
    return () => { live = false; };
  }, [item.kicksId]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const targetWidth = Math.min(560, vw - 40);
  const targetHeight = Math.min(880, vh - 56);
  const targetTop = Math.max(28, (vh - targetHeight) / 2);
  const targetLeft = Math.max(20, (vw - targetWidth) / 2);

  const startBuying = () => {
    const suggested =
      typeof item.marketPrice === 'number' && item.marketPrice > 0
        ? String(Math.round(item.marketPrice))
        : item.price || '';
    setPaidDraft(suggested);
    setBuying(true);
  };

  const spec = [
    ['My rating', typeof item.rating === 'number' ? `${formatRating(item.rating)} / 10` : '—'],
    [item.status === 'owned' ? 'Paid' : 'Target', formatPrice(item.price)],
    ['Market', typeof item.marketPrice === 'number' && item.marketPrice > 0
      ? `$${Math.round(item.marketPrice).toLocaleString()}` : 'No listings'],
    ['Size', item.size || '—'],
    ['SKU', item.sku || '—'],
    ['Added', item.addedAt ? new Date(item.addedAt).toLocaleDateString(undefined,
      { day: 'numeric', month: 'short', year: 'numeric' }) : '—'],
    ...(item.acquiredAt
      ? [['Bought', new Date(item.acquiredAt).toLocaleDateString(undefined,
          { day: 'numeric', month: 'short', year: 'numeric' })]]
      : []),
    ['Checked', item.marketPriceUpdatedAt ? new Date(item.marketPriceUpdatedAt).toLocaleDateString(undefined,
      { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never'],
  ];

  return (
    <motion.div
      className="sd-detail-panel"
      onClick={(e) => e.stopPropagation()}
      initial={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      animate={{ top: targetTop, left: targetLeft, width: targetWidth, height: targetHeight }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
    >
      <motion.div
        className="sd-detail-content"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { delay: 0.14, duration: 0.24 } }}
      >
        <button type="button" className="sd-detail-close" onClick={onClose} aria-label="Close">
          <X size={17} />
        </button>

        {/* The chevrons live outside the re-keyed plate so they stay put
            while the photograph behind them changes -- chrome that flickered
            on every step would read as part of the shoe. */}
        <div className="sd-detail-stage">
          <motion.div
            className="sd-detail-plate"
            key={`plate-${item.id}`}
            initial={{ opacity: 0, x: dir * 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <Photo
              className="sd-detail-photo"
              src={item.imageUrl ? normalizeProductImage(item.imageUrl) : null}
              alt={`${item.brand} ${item.model} ${item.colorway}`}
              empty="No photo"
            />
          </motion.div>

          <button
            type="button"
            className="sd-detail-nav prev"
            onClick={() => onStep(-1)}
            disabled={!hasPrev}
            aria-label="Previous pair"
            title="Previous pair (←)"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="sd-detail-nav next"
            onClick={() => onStep(1)}
            disabled={!hasNext}
            aria-label="Next pair"
            title="Next pair (→)"
          >
            <ChevronRight size={18} />
          </button>

          {position.total > 1 && position.index >= 0 && (
            <p className="sd-detail-counter">
              {position.index + 1} / {position.total}
            </p>
          )}
        </div>

        <motion.div
          className="sd-detail-body"
          key={`body-${item.id}`}
          initial={{ opacity: 0, x: dir * 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          <p className="sd-brand">{item.brand}</p>
          <h2 className="sd-detail-model">{item.model}</h2>
          {item.colorway && <p className="sd-detail-colorway">{item.colorway}</p>}

          <p className={`sd-move ${movement.flag ? 'flagged' : ''}`}>{movement.text}</p>

          {item.tags && item.tags.length > 0 && (
            <div className="sd-detail-tags">
              {item.tags.map((tag) => (
                <span className="sd-detail-tag" key={tag}>{tag}</span>
              ))}
            </div>
          )}

          <h3 className="sd-detail-heading">Price history</h3>
          {series === null
            ? <p className="sd-history-empty">Reading record…</p>
            : <PriceHistory series={series} basis={parseFloat(item.price)} />}

          <h3 className="sd-detail-heading">Specification</h3>
          <dl className="sd-detail-spec">
            {spec.map(([k, v]) => (
              <div className="sd-detail-spec-row" key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          {item.notes && (
            <>
              <h3 className="sd-detail-heading">Notes</h3>
              <p className="sd-detail-notes">{item.notes}</p>
            </>
          )}
        </motion.div>

        {canEdit && <div className="sd-detail-actions">
          {buying ? (
            // States plainly what is about to be written before it writes it.
            <div className="sd-acquire">
              <label className="sd-acquire-field">
                <span>Paid</span>
                <input
                  autoFocus
                  value={paidDraft}
                  onChange={(e) => setPaidDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onAcquire(item, paidDraft); }}
                  inputMode="decimal"
                />
              </label>
              <p className="sd-acquire-note">
                Moves {item.model} to Holdings and records what you paid.
              </p>
              <div className="sd-acquire-actions">
                <button type="button" className="sd-cancel-btn" onClick={() => setBuying(false)}>Cancel</button>
                <button type="button" className="sd-save-btn" onClick={() => onAcquire(item, paidDraft)}>
                  <Check size={14} /> Move to Holdings
                </button>
              </div>
            </div>
          ) : confirmingDelete ? (
            <>
              <button type="button" className="sd-confirm-btn no" onClick={() => setConfirmingDelete(false)}>Cancel</button>
              <button type="button" className="sd-confirm-btn yes" onClick={() => onDelete(item.id)}>Remove pair</button>
            </>
          ) : (
            <>
              <button type="button" className="sd-cancel-btn" onClick={() => setConfirmingDelete(true)}>
                <Trash2 size={14} /> Remove
              </button>
              <button type="button" className="sd-cancel-btn" onClick={() => onEdit(item)}>
                <Pencil size={14} /> Edit
              </button>
              {item.kicksId && (
                <button
                  type="button"
                  className="sd-cancel-btn"
                  onClick={() => onRefreshOne(item)}
                  title="Re-check this pair's market price — one request"
                >
                  <RefreshCw size={14} /> Re-check
                </button>
              )}
              {wanted && (
                <button type="button" className="sd-save-btn sd-acquire-btn" onClick={startBuying}>
                  <Check size={14} /> I bought this
                </button>
              )}
            </>
          )}
        </div>}
      </motion.div>
    </motion.div>
  );
}

export default function SneakerStockroom() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [register, setRegister] = useState('owned');
  const [sort, setSort] = useState('manual');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addedIds, setAddedIds] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [brokenImages, setBrokenImages] = useState(() => new Set());
  const [saveError, setSaveError] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);

  const checkAuth = async () => {
    try {
      const res = await apiFetch(AUTH_API);
      const data = await res.json();
      setCanEdit(Boolean(data.canEdit));
      setAuthRequired(Boolean(data.authRequired));
      return Boolean(data.canEdit);
    } catch {
      setCanEdit(false);
      return false;
    }
  };

  useEffect(() => { checkAuth(); }, []);

  const signIn = async (token) => {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ }
    const ok = await checkAuth();
    if (!ok) {
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
    }
    return ok;
  };

  const signOut = () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
    checkAuth();
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const [detail, setDetail] = useState(null);
  const addBtnRef = useRef(null);

  // Read by the arrow-key listener below, which is bound once and so cannot
  // close over `filtered` -- that array is rebuilt on every render.
  const navRef = useRef({ detail: null, filtered: [] });

  const showToast = (message) => {
    setToast({ id: Date.now(), message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(COLLECTION_API);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        const serverItems = Array.isArray(data.items) ? data.items : [];

        if (serverItems.length > 0) {
          setItems(serverItems);
        } else {
          // One-time migration: carry over anything saved by the old
          // localStorage-only version of this app, then push it to the
          // server so it becomes the source of truth from here on.
          const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
          const legacyItems = legacyRaw ? JSON.parse(legacyRaw) : null;
          if (Array.isArray(legacyItems) && legacyItems.length > 0) {
            setItems(legacyItems);
            await apiFetch(COLLECTION_API, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items: legacyItems }),
            });
            localStorage.removeItem(LEGACY_STORAGE_KEY);
          }
        }
        setSaveError('');
      } catch {
        setSaveError('Could not reach the collection server — start it with npm run dev:all, then reload.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Escape closes whichever overlay is currently on top: the detail panel
  // takes priority since it can be opened from behind the add/edit drawer's
  // own trigger point (a card click while nothing else is open).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (detail) setDetail(null);
      else if (addOpen) closeAdd();
      else if (formOpen) closeForm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, formOpen, addOpen]);

  // Left/right walk the register from inside the detail view. Bound once and
  // driven off navRef, because re-subscribing on every render just to keep a
  // fresh `filtered` in scope would churn a listener 60 times a scroll.
  //
  // Ignored while a field has focus: the acquire flow puts a price input
  // inside this very panel, and moving the caret must never turn the page.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (!navRef.current.detail) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      stepDetail(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A failed save is reported as precisely as the failure allows. The old
  // message asked "is the server running?" for every kind of failure, which
  // was actively misleading when the server was running fine and rejecting
  // the write on purpose -- a 413, once the collection outgrew the body limit,
  // read as a flaky connection rather than as "this will never succeed and
  // everything you add now is being thrown away".
  const persist = async (next, message) => {
    if (!canEdit) return;
    setItems(next);
    try {
      const res = await apiFetch(COLLECTION_API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next }),
      });
      if (!res.ok) {
        let detail = '';
        try {
          const body = await res.json();
          detail = body.detail || body.error || '';
        } catch {
          detail = '';
        }
        throw Object.assign(new Error(detail || `status ${res.status}`), { status: res.status });
      }
      setSaveError('');
      if (message) showToast(message);
    } catch (e) {
      setSaveError(
        e.status
          ? `NOT SAVED — the server refused this change (HTTP ${e.status}). ${e.message} Anything you add now will be lost on reload.`
          : 'NOT SAVED — could not reach the collection server. Anything you add now will be lost on reload. Is it running?'
      );
    }
  };

  // Debounced KicksDB search while the "Add pair" form is open.
  useEffect(() => {
    if (!formOpen && !addOpen) return;
    const trimmed = searchTerm.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchError('');
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await apiFetch(`${SEARCH_API}?q=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        if (!res.ok) {
          setSearchError(data.error || 'Search failed');
          setSearchResults([]);
        } else {
          setSearchResults(Array.isArray(data.results) ? data.results : []);
          setSearchError('');
        }
      } catch {
        setSearchError('Could not reach the search server — is it running on :8787?');
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [searchTerm, formOpen, addOpen]);

  const { ownedCount, wantCount, collectionValue, hasTrackedValue } = getCollectionStats(items);

  // Tags still feed the add/edit form's autocomplete; what they no longer do
  // is occupy a filter row. One tag ("Basketball") covers 88 of 95 records, so
  // the chips could not narrow anything -- the search field absorbed the job.
  const allTags = getAllTags(items);

  // The silhouette is the axis that actually discriminates: 54 distinct values
  // across 95 records. It only exists because the backfill split the
  // brand-prefixed title apart.
  const silhouetteCount = new Set(items.map((i) => i.model).filter(Boolean)).size;

  // 86 of 95 pairs are the same size. Defaulting to whatever this collection
  // actually wears removes the only other field worth typing.
  const defaultSize = (() => {
    const counts = items.reduce((acc, i) => {
      if (i.size) acc[i.size] = (acc[i.size] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  })();

  const switchRegister = (next) => setRegister(next);

  const filtered = sortItems(filterItems(items, { register, query }), sort);

  // The tally reads off `filtered`, the same array the grid maps over, so it
  // can never disagree with what is on screen. `query` is plain state written
  // straight from onChange -- no debounce on this path -- so typing the "2" in
  // "Book 2" re-renders and re-counts on that keystroke. The trailing clause
  // names what narrowed the list: the register when nothing is typed (so the
  // figure matches the tab you are in), the search term once something is.
  const trimmedQuery = query.trim();
  const tallyQualifier = trimmedQuery
    ? `matching \u201C${trimmedQuery}\u201D`
    : register === 'owned'
    ? 'held'
    : register === 'want'
    ? 'wanted'
    : 'in the stockroom';

  // What you can page through is exactly what you can see: the detail view
  // steps along `filtered`, so the current register, search and sort all
  // carry into it and the sequence matches the grid it was opened from.
  navRef.current = { detail, filtered };
  const detailIndex = detail ? filtered.findIndex((i) => i.id === detail.item.id) : -1;

  // Clamped rather than wrapping. Reaching the end of a register and landing
  // back on the first pair reads as a glitch, and the disabled chevron says
  // where the edge is.
  const stepDetail = (dir) => {
    const { detail: open, filtered: list } = navRef.current;
    if (!open) return;
    const idx = list.findIndex((i) => i.id === open.item.id);
    const next = idx + dir;
    if (idx === -1 || next < 0 || next >= list.length) return;
    setDetail((d) => (d ? { ...d, item: list[next], dir } : d));
  };

  const renderPlate = (item) => (
    <Plate
      key={item.id}
      item={item}
      openDetail={openDetail}
      brokenImages={brokenImages}
      setBrokenImages={setBrokenImages}
      isDragging={draggedId === item.id}
      isDragOver={dragOverId === item.id && draggedId !== item.id}
      onDragStart={handleDragStart}
      onDragOverCard={handleDragOverCard}
      onDropCard={handleDropCard}
      onDragEnd={handleDragEnd}
      canEdit={canEdit}
    />
  );



  const resetSearch = () => {
    setSearchTerm('');
    setSearchResults([]);
    setSearchError('');
    setSearchLoading(false);
  };

  const openAddForm = () => {
    resetSearch();
    setAddedIds([]);
    setAddOpen(true);
  };

  const closeAdd = () => {
    setAddOpen(false);
    setAddedIds([]);
    resetSearch();
  };

  // The full form is still reachable for a pair KicksDB does not have.
  const openManualForm = () => {
    setAddOpen(false);
    setForm({ ...emptyForm, status: register === 'want' ? 'want' : 'owned', size: defaultSize });
    resetSearch();
    setFormOpen(true);
  };

  // A search result IS the add. Files immediately with the fields KicksDB
  // supplies plus the size this collection actually uses; price is left for
  // the inline row, because a target is a decision rather than an observation.
  const addFromSearch = (result, status) => {
    const fields = pairFieldsFromSearchResult(result);
    const pair = {
      ...EMPTY_PAIR,
      ...fields,
      id: genId(),
      status,
      size: defaultSize,
      price: '',
      tags: [],
      marketPriceUpdatedAt: fields.marketPrice !== null ? new Date().toISOString() : null,
      addedAt: new Date().toISOString(),
    };
    persist([...items, pair], null);
    setAddedIds((prev) => [pair.id, ...prev]);
  };

  const setAddedPrice = (id, price) => {
    persist(items.map((i) => (i.id === id ? { ...i, price: price.trim() } : i)), null);
  };

  const undoAdd = (id) => {
    persist(items.filter((i) => i.id !== id), 'Removed');
    setAddedIds((prev) => prev.filter((x) => x !== id));
  };

  const openEditForm = (item) => {
    setDetail(null);
    setForm({ ...emptyForm, ...item, tags: item.tags || [] });
    resetSearch();
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setForm(emptyForm);
    resetSearch();
  };

  const openDetail = (item, el) => {
    const rect = el.getBoundingClientRect();
    setDetail({ item, rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height } });
  };

  // The mapping is decided once, in @stockroom/shared/kicksdb. `model` is the
  // silhouette with the brand prefix stripped ("Book 1", not "Nike Book 1")
  // and `colorway` is KicksDB's secondary_title, which this used to discard
  // entirely — leaving every record with a duplicated brand and a blank
  // colorway the card still reserved space for.
  const selectSearchResult = (result) => {
    const fields = pairFieldsFromSearchResult(result);
    setForm((f) => ({
      ...f,
      brand: fields.brand || f.brand,
      model: fields.model || f.model,
      colorway: fields.colorway || f.colorway,
      imageUrl: fields.imageUrl || f.imageUrl,
      kicksId: fields.kicksId || f.kicksId,
      sku: fields.sku || f.sku,
      marketPrice: fields.marketPrice ?? f.marketPrice,
      marketPriceUpdatedAt:
        fields.marketPrice !== null ? new Date().toISOString() : f.marketPriceUpdatedAt,
    }));
    resetSearch();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.brand.trim() || !form.model.trim()) return;
    const exists = items.some((i) => i.id === form.id);
    const cleaned = toStoredPair(form, { generateId: genId });
    const next = exists
      ? items.map((i) => (i.id === cleaned.id ? cleaned : i))
      : [...items, cleaned];
    const message = exists ? 'Changes saved' : `Added to ${cleaned.status === 'owned' ? 'I Have' : 'I Will Have'}`;
    persist(next, message);
    closeForm();

  };

  // want -> owned. The central act of a collection app, and until now it was
  // an accident of the edit form: open Edit, find the segmented control, flip
  // it, then retype the price into a field still labelled "Target price".
  // Writes exactly two fields; everything else on the record is untouched.
  const acquirePair = (item, paid) => {
    const cleanPaid = String(paid ?? '').trim().replace(/^\$/, '');
    const next = items.map((i) =>
      i.id === item.id
        ? { ...i, status: 'owned', price: cleanPaid, acquiredAt: new Date().toISOString() }
        : i
    );
    persist(next, `${item.model} moved to Holdings`);
    setDetail(null);
  };

  const deleteItem = (id) => {
    persist(items.filter((i) => i.id !== id), 'Removed from your stockroom');
    setDetail((d) => (d?.item.id === id ? null : d));
  };

  // Native HTML5 drag-and-drop reorder — chosen over framer-motion's Reorder
  // component because Reorder only compares position along one axis, which
  // falls apart in a multi-column CSS grid (that's what caused the erratic
  // swaps). Native drag-and-drop hit-tests per grid cell instead, so it
  // doesn't care how many columns there are, and the browser's own drag
  // ghost is always compositied above everything else — no z-index fights.
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const handleDragStart = (id) => setDraggedId(id);
  const handleDragOverCard = (id) => setDragOverId((prev) => (prev === id ? prev : id));
  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  // `filtered` is only the currently-visible subset (current tab, current
  // search). Splice the moved item back into the full items array at the
  // same slots those ids already occupied, so the other tab's order and
  // any filtered-out items are left untouched.
  const handleDropCard = (targetId) => {
    const sourceId = draggedId;
    setDraggedId(null);
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;

    const sourceIndex = filtered.findIndex((i) => i.id === sourceId);
    const targetIndex = filtered.findIndex((i) => i.id === targetId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const reordered = [...filtered];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    const visibleIds = new Set(filtered.map((i) => i.id));
    const slots = [];
    items.forEach((it, i) => {
      if (visibleIds.has(it.id)) slots.push(i);
    });
    const next = [...items];
    reordered.forEach((item, i) => {
      next[slots[i]] = item;
    });
    persist(next);
  };

  const [refreshingPrices, setRefreshingPrices] = useState(false);

  // Stale-first and capped. The old version sent every tracked pair on every
  // press — 95 requests, most of them re-fetching a price checked minutes
  // earlier. Now the button says what it will spend before it spends it.
  const refresh = getRefreshCandidates(items);

  const refreshPrices = async () => {
    if (refresh.candidates.length === 0) {
      showToast(
        refresh.trackable === 0
          ? 'Add pairs via search to track their price'
          : 'Prices are already current'
      );
      return;
    }
    setRefreshingPrices(true);
    try {
      const res = await apiFetch(PRICES_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: refresh.candidates.map((i) => i.kicksId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `status ${res.status}`);
      const now = new Date().toISOString();
      let updated = 0;
      const next = items.map((i) => {
        const price = i.kicksId ? data.prices?.[i.kicksId] : undefined;
        if (typeof price !== 'number') return i;
        updated += 1;
        return { ...i, marketPrice: price, marketPriceUpdatedAt: now };
      });
      persist(
        next,
        updated > 0
          ? `Updated ${updated} pair${updated === 1 ? '' : 's'}${refresh.capped ? ` · ${refresh.staleCount - updated} still stale` : ''}`
          : 'No price updates came back — try again shortly'
      );
    } catch (e) {
      setSaveError(String(e.message || e));
    } finally {
      setRefreshingPrices(false);
    }
  };

  // One pair, one request — for when you only care about this shoe.
  const refreshOne = async (item) => {
    if (!item.kicksId) return;
    try {
      const res = await apiFetch(PRICES_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [item.kicksId] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `status ${res.status}`);
      const price = data.prices?.[item.kicksId];
      if (typeof price !== 'number') {
        showToast('No price came back for this pair');
        return;
      }
      const now = new Date().toISOString();
      persist(
        items.map((i) =>
          i.id === item.id ? { ...i, marketPrice: price, marketPriceUpdatedAt: now } : i
        ),
        `${item.model} now $${Math.round(price).toLocaleString()}`
      );
      setDetail((d) =>
        d && d.item.id === item.id
          ? { ...d, item: { ...d.item, marketPrice: price, marketPriceUpdatedAt: now } }
          : d
      );
    } catch (e) {
      setSaveError(String(e.message || e));
    }
  };

  return (
    <div className="sd-root">
      <header className="sd-masthead">
        <h1 className="sd-wordmark">The Stockroom</h1>
        <p className="sd-standfirst">
          <span><b>{ownedCount}</b> held</span>
          <span><b>{wantCount}</b> wanted</span>
          {hasTrackedValue && (
            <span><b>${Math.round(collectionValue).toLocaleString()}</b> est. value</span>
          )}
          <span><b>{silhouetteCount}</b> silhouettes</span>
        </p>
      </header>

      <div className="sd-toolbar">
        <div className="sd-registers">
          {[
            { id: 'owned', label: 'Holdings', count: ownedCount },
            { id: 'want', label: 'Acquisitions', count: wantCount },
          ].map((r) => (
            <button
              key={r.id}
              type="button"
              className={`sd-register-tab ${register === r.id ? 'active' : ''}`}
              onClick={() => switchRegister(r.id)}
            >
              {r.label}
              <span className="sd-register-count">{r.count}</span>
            </button>
          ))}
          {/* All sits apart and reads quieter: it is a way to search across
              both registers at once, not the primary view of the collection. */}
          <button
            type="button"
            className={`sd-register-tab is-secondary ${register === 'all' ? 'active' : ''}`}
            onClick={() => switchRegister('all')}
          >
            Both
            <span className="sd-register-count">{items.length}</span>
          </button>
        </div>

        <div className="sd-actions">
          <div className="sd-search">
            <Search size={14} />
            <input
              placeholder="Silhouette, colourway, brand, tag…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="sd-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={13} />
              </button>
            )}
          </div>

          <SortMenu value={sort} options={SORTS} onChange={setSort} />

          {canEdit && <button
            type="button"
            className="sd-refresh"
            onClick={refreshPrices}
            disabled={refreshingPrices}
            title={`${describeRefreshDetail(refresh)} Last ${describeLastChecked(items)}.`}
          >
            <RefreshCw size={14} />
            {refreshingPrices ? 'Updating…' : describeRefreshCost(refresh)}
          </button>}

          {canEdit && <button ref={addBtnRef} type="button" className="sd-add" onClick={openAddForm}>
            <Plus size={14} /> Add pair
          </button>}
        </div>
      </div>

      {saveError && <p className="sd-error">{saveError}</p>}

      {loading ? (
        <div className="sd-loading">Opening the stockroom…</div>
      ) : (
        // No cross-fade between registers. AnimatePresence mode="wait" held a
        // snapshot of the outgoing tab and its exit never resolved with the
        // nested per-plate AnimatePresence inside it, so switching tabs left
        // the old register on screen permanently. A tab switch does not need
        // an animation in this direction anyway.
        <>
            {/* Suppressed at zero: the empty panel below already says what
                found nothing, and "0 pairs" above it would say it twice. */}
            {filtered.length > 0 && (
              <p className="sd-tally" aria-live="polite">
                <b>{filtered.length}</b> {filtered.length === 1 ? 'pair' : 'pairs'}{' '}
                <span className="sd-tally-qual">{tallyQualifier}</span>
              </p>
            )}
            {filtered.length === 0 ? (
              <div className="sd-empty">
                {items.length > 0 && query.trim() ? (
                  <>
                    <p className="sd-empty-title">Nothing matches “{query.trim()}”</p>
                    <p className="sd-empty-body">
                      The search reads silhouette, colourway, brand, tag and SKU. Try a
                      shorter term — “kobe” rather than “kobe 5 protro”.
                    </p>
                    <button type="button" className="sd-empty-clear-btn" onClick={() => setQuery('')}>
                      Clear search
                    </button>
                  </>
                ) : (
                  <>
                    <p className="sd-empty-title">
                      {items.length === 0
                        ? 'The stockroom is empty'
                        : register === 'owned'
                        ? 'No pairs held yet'
                        : 'Nothing on the acquisitions list'}
                    </p>
                    <p className="sd-empty-body">
                      {register === 'want'
                        ? 'Add a pair you are chasing and its market price will be tracked against your target.'
                        : 'Add your first pair — search KicksDB and the photography, colourway and price come with it.'}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className={`sd-register ${register}`}>
                {filtered.map((item) => renderPlate(item))}
              </div>
            )}
        </>
      )}

      {/* Rendered without AnimatePresence. Exit animations do not resolve in
          this app -- framer-motion keeps the node mounted after React state
          has already gone to null, which left the panel permanently on screen
          and the tab register frozen on the previous list. Entrance
          animations (initial/animate) work fine and do not need
          AnimatePresence, so the detail panel still grows out of the plate it
          was opened from; only the closing animation is given up. */}
      {detail && (
          <motion.div
            className="sd-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
            onClick={() => setDetail(null)}
          >
            <DetailPanel
              detail={detail}
              position={{ index: detailIndex, total: filtered.length }}
              hasPrev={detailIndex > 0}
              hasNext={detailIndex >= 0 && detailIndex < filtered.length - 1}
              onStep={stepDetail}
              onClose={() => setDetail(null)}
              onEdit={openEditForm}
              onDelete={deleteItem}
              onAcquire={acquirePair}
              onRefreshOne={refreshOne}
              canEdit={canEdit}
            />
          </motion.div>
        )}

      {addOpen && (
        <motion.div
          className="sd-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => { if (e.target === e.currentTarget) closeAdd(); }}
        >
          <AddPanel
            open={addOpen}
            register={register}
            defaultSize={defaultSize}
            results={searchResults}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            searchLoading={searchLoading}
            searchError={searchError}
            onAdd={addFromSearch}
            onSetPrice={setAddedPrice}
            added={addedIds.map((id) => items.find((i) => i.id === id)).filter(Boolean)}
            onUndo={undoAdd}
            onManual={openManualForm}
            onClose={closeAdd}
          />
        </motion.div>
      )}

      {formOpen && (
          <motion.div
            className="sd-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => {
              if (e.target === e.currentTarget) closeForm();
            }}
          >
            <motion.form
              className="sd-form"
              onSubmit={handleSubmit}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            >
              <div className="sd-form-head">
                <h2>{form.id ? 'Edit pair' : 'New pair'}</h2>
                <button type="button" onClick={closeForm} aria-label="Close">
                  <X size={18} />
                </button>
              </div>

              {form.imageUrl && (
                <div className="sd-form-preview">
                  <img src={normalizeProductImage(form.imageUrl)} alt="Preview" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                </div>
              )}

              <div className="sd-lookup">
                <label className="sd-lookup-label" htmlFor="sd-lookup-input">
                  Look up on KicksDB
                </label>
                <div className="sd-lookup-box">
                  <Search size={14} />
                  <input
                    id="sd-lookup-input"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search a sneaker to auto-fill…"
                    autoComplete="off"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      className="sd-lookup-clear"
                      onClick={() => setSearchTerm('')}
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                {searchLoading && <p className="sd-lookup-hint">Searching…</p>}
                {!searchLoading && searchError && (
                  <p className="sd-lookup-error">{searchError}</p>
                )}
                {!searchLoading && !searchError && !searchTerm.trim() && (
                  <div className="sd-lookup-idle">
                    <Search size={18} />
                    Start typing a model name — results show every colorway KicksDB has for it
                  </div>
                )}
                {!searchLoading && !searchError && searchTerm.trim() && searchResults.length === 0 && (
                  <div className="sd-lookup-idle">
                    <ImageOff size={18} />
                    No matches for “{searchTerm.trim()}” — try the model name without the colorway
                  </div>
                )}
                {!searchLoading && !searchError && searchResults.length > 0 && (
                  <ul className="sd-lookup-results">
                    {searchResults.map((result, idx) => (
                      <li key={result.id || `${result.sku}-${idx}`}>
                        <button
                          type="button"
                          className="sd-lookup-result"
                          onClick={() => selectSearchResult(result)}
                        >
                          <span className="sd-lookup-thumb">
                            {result.imageUrl ? (
                              <img src={normalizeProductImage(result.imageUrl, { width: 300 })} alt="" loading="lazy" />
                            ) : (
                              <ImageOff size={20} />
                            )}
                            {typeof result.marketPrice === 'number' && (
                              <span className="sd-lookup-price">
                                ${Math.round(result.marketPrice)}
                              </span>
                            )}
                          </span>
                          <span className="sd-lookup-text">
                            <p className="sd-lookup-brand">{result.brand || 'Unknown'}</p>
                            <p className="sd-lookup-model">
                              {result.colorway || result.model || 'Untitled'}
                            </p>
                            {result.model && (
                              <p className="sd-lookup-colorway">{result.model}</p>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="sd-form-status">
                <button
                  type="button"
                  className={`owned ${form.status === 'owned' ? 'active' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, status: 'owned' }))}
                >
                  I own this
                </button>
                <button
                  type="button"
                  className={`want ${form.status === 'want' ? 'active' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, status: 'want' }))}
                >
                  On my list
                </button>
              </div>

              <div className="sd-form-grid">
                <label>
                  Brand
                  <input
                    required
                    value={form.brand}
                    onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                    placeholder="Nike"
                  />
                </label>
                <label>
                  Model
                  <input
                    required
                    value={form.model}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                    placeholder="Kobe 6 Protro"
                  />
                </label>
                <label className="sd-span2">
                  Colorway
                  <input
                    value={form.colorway}
                    onChange={(e) => setForm((f) => ({ ...f, colorway: e.target.value }))}
                    placeholder="Mambacita Sweet 16"
                  />
                </label>
                <label>
                  Size
                  <input
                    value={form.size}
                    onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
                    placeholder="9.5 US"
                  />
                </label>
                <label>
                  {form.status === 'owned' ? 'Price paid' : 'Target price'}
                  <input
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    placeholder="optional"
                  />
                </label>
                <label>
                  My rating
                  {/* Left empty unless you say otherwise — an unrated pair is
                      not a pair rated zero, and clearing the box removes the
                      rating rather than storing one. */}
                  <input
                    value={form.rating ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, rating: e.target.value }))}
                    placeholder="optional — 0 to 10"
                    inputMode="decimal"
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                  />
                </label>
                <label className="sd-span2">
                  Photo
                  <PhotoDrop
                    value={form.imageUrl}
                    uploadApi={UPLOAD_API}
                    flipApi={FLIP_API}
                    onUploaded={(url) => setForm((f) => ({ ...f, imageUrl: `${API_BASE}${url}` }))}
                  />
                  <input
                    value={form.imageUrl}
                    onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                    placeholder="…or paste a link to an image"
                  />
                </label>
                <label className="sd-span2">
                  Notes
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="optional — where you got it, what you're waiting on, etc."
                  />
                </label>
                <label className="sd-span2">
                  Tags
                  <TagInput
                    value={form.tags}
                    onChange={(next) => setForm((f) => ({ ...f, tags: next }))}
                    suggestions={allTags}
                  />
                </label>
              </div>

              <div className="sd-form-actions">
                <button type="button" className="sd-cancel-btn" onClick={closeForm}>
                  Cancel
                </button>
                <button type="submit" className="sd-save-btn">
                  Save pair
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}

      {toast && (
          <motion.div
            key={toast.id}
            className="sd-toast"
            initial={{ opacity: 0, y: 20, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            {toast.message}
          </motion.div>
        )}
      <OwnerBar canEdit={canEdit} authRequired={authRequired} onSignIn={signIn} onSignOut={signOut} />
    </div>
  );
}
