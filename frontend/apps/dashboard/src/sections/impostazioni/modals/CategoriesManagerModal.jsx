import { withPortalForm } from '@youty/shared';
import { MutationButton } from '@youty/shared';
// CategoriesManagerModal.jsx — port of CategoriesManager/CatEditModal (drawer UI)
// over the three real category APIs. Opened with openModal('catsmgr', { kind }).
//   clienti   → /api/clients/categories      {name, color, order}      (write: scope clients)
//   servizi   → /api/catalog/categories      {name_it, name_en, color, order} (write: scope pricing)
//   magazzino → /api/inventory/categories    {name, order}             (write: scope inventory)
// Drag-reorder: per-item PUT of `order` for ALL kinds. NOTE: the dedicated
// POST /api/catalog/categories/reorder is currently shadowed by the
// /categories/{category_id} route (405) — backend bug reported; switch back
// to it once fixed.
import React, { useCallback, useEffect, useState } from 'react';
import { api, Icon, EmptyState } from '@youty/shared';
import DkDrawer from '../../../ui/DkDrawer.jsx';
import DkModal from '../../../ui/DkModal.jsx';
import HexInput from '../../../ui/HexInput.jsx';
import { useDash } from '../../../ctx.jsx';
import { GD_PALETTE, PaletteGrid, inputCss, toastErr, LockNote } from '../lib.jsx';

const KINDS = {
  clienti: { base: '/api/clients/categories', scope: 'clients', hasColor: true, bilingual: false },
  servizi: { base: '/api/catalog/categories', scope: 'pricing', hasColor: true, bilingual: true },
  magazzino: { base: '/api/inventory/categories', scope: 'inventory', hasColor: false, bilingual: false },
};
const flatPalette = GD_PALETTE.flat().filter((c) => !['#000000', '#FFFFFF', '#F3F3F3', '#EFEFEF'].includes(c));
const randColor = () => flatPalette[Math.floor(Math.random() * flatPalette.length)];
const catName = (c, kind, lang) => (KINDS[kind].bilingual ? ((lang === 'en' && c.name_en) ? c.name_en : c.name_it) : c.name);

// Accepts both `kind` (servizi agent) and `scope` (clienti agent) for the initial tab.
export default function CategoriesManagerModal({ onClose, kind: kindProp, scope: scopeProp }) {
  const { t, lang, hasScope, canMutate, reload, fireToast } = useDash();
  const initialKind = kindProp ?? scopeProp;
  const [kind, setKind] = useState(initialKind && KINDS[initialKind] ? initialKind : 'clienti');
  const [lists, setLists] = useState({ clienti: null, servizi: null, magazzino: null });
  const [dragIdx, setDragIdx] = useState(null);
  const [edit, setEdit] = useState(null); // draft { _new?, id?, name/name_it/name_en, color }
  const cfg = KINDS[kind];
  const list = lists[kind];
  const canWrite = hasScope(cfg.scope);

  const setList = (k, v) => setLists((s) => ({ ...s, [k]: v }));

  const load = useCallback(async (k) => {
    try { const res = await api.get(KINDS[k].base); setLists((s) => ({ ...s, [k]: res })); }
    catch (err) { toastErr(err, fireToast, t); setLists((s) => ({ ...s, [k]: [] })); }
  }, [fireToast, t]);
  useEffect(() => { if (lists[kind] === null) load(kind); }, [kind, lists, load]);

  const syncCtx = (k) => {
    if (k === 'clienti') reload.clientCategories();
    if (k === 'servizi') reload.serviceCategories();
  };

  const payloadOf = (d) => {
    if (kind === 'servizi') return { name_it: (d.name_it || '').trim(), name_en: (d.name_en || '').trim(), color: d.color || '#CCCCCC' };
    if (kind === 'clienti') return { name: (d.name || '').trim(), color: d.color || '#CCCCCC' };
    return { name: (d.name || '').trim() };
  };

  const save = async (d) => {
    try {
      if (d._new) {
        const created = await api.post(cfg.base, { ...payloadOf(d), order: (list || []).length });
        setList(kind, [...(list || []), created]);
      } else {
        const upd = await api.put(`${cfg.base}/${d.id}`, { ...payloadOf(d), order: d.order ?? 0 });
        setList(kind, list.map((c) => (c.id === d.id ? upd : c)));
      }
      syncCtx(kind);
      setEdit(null);
      fireToast({ msg: t('Categoria salvata', 'Category saved'), icon: 'check' });
    } catch (err) { toastErr(err, fireToast, t); }
  };

  const del = async (id) => {
    try {
      await api.del(`${cfg.base}/${id}`);
      setList(kind, list.filter((c) => c.id !== id));
      syncCtx(kind);
      setEdit(null);
      fireToast({ msg: t('Categoria eliminata', 'Category deleted'), icon: 'x' });
    } catch (err) { toastErr(err, fireToast, t); } // e.g. 400 if services attached
  };

  const reorder = async (fromI, toI) => {
    const next = [...list];
    const [moved] = next.splice(fromI, 1);
    next.splice(toI, 0, moved);
    setList(kind, next); // optimistic
    try {
      const body = (c) => (kind === 'servizi'
        ? { name_it: c.name_it, name_en: c.name_en || '', color: c.color }
        : kind === 'clienti' ? { name: c.name, color: c.color } : { name: c.name });
      await Promise.all(next.map((c, i) => api.put(`${cfg.base}/${c.id}`, { ...body(c), order: i })));
      await load(kind);
      syncCtx(kind);
      fireToast({ msg: t('Ordine aggiornato', 'Order updated'), icon: 'check' });
    } catch (err) { toastErr(err, fireToast, t); load(kind); }
  };

  const blank = () => (kind === 'servizi'
    ? { _new: true, name_it: '', name_en: '', color: randColor() }
    : { _new: true, name: '', color: randColor() });

  const types = [
    ['clienti', t('Clienti', 'Clients'), 'clients'],
    ['servizi', t('Servizi', 'Services'), 'scissors'],
    ['magazzino', t('Magazzino', 'Inventory'), 'box'],
  ];

  return (
    <DkDrawer open onClose={onClose}>
      <div style={{ padding: '22px 22px 0', borderBottom: '1px solid var(--hair)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 500 }}>{t('Categorie', 'Categories')}</div>
            <div className="t-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>{t('Crea e modifica le categorie', 'Create and edit categories')}</div>
          </div>
          <button className="dk-iconbtn" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {types.map(([k, l, ic]) => (
            <button key={k} onClick={() => setKind(k)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 4px', marginRight: 18, fontSize: 14.5, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', color: kind === k ? 'var(--ink)' : 'var(--muted)', borderBottom: '2px solid ' + (kind === k ? 'var(--clay)' : 'transparent'), marginBottom: -1 }}>
              <Icon name={ic} size={16} color={kind === k ? 'var(--clay-ink)' : 'var(--muted)'} />{l}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 30px' }}>
        {canWrite ? (
          <MutationButton className="dk-btn dk-btn--clay" style={{ width: '100%', marginBottom: 16 }} onClick={() => setEdit(blank())}><Icon name="plus" size={16} color="#fff" />{t('Nuova categoria', 'New category')}</MutationButton>
        ) : (
          <div style={{ marginBottom: 16 }}><LockNote t={t} msg={t('Non hai il permesso per modificare queste categorie.', 'You lack the permission to edit these categories.')} /></div>
        )}

        {list === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 48, borderRadius: 12 }} />)}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map((c, i) => (
              <div key={c.id} className="dk-card dk-row" draggable={canMutate(cfg.scope)}
                onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={(e) => { e.preventDefault(); if (canMutate(cfg.scope) && dragIdx !== null && dragIdx !== i) reorder(dragIdx, i); setDragIdx(null); }}
                onDragEnd={() => setDragIdx(null)}
                onClick={canWrite ? () => setEdit({ ...c }) : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px', boxShadow: 'none', border: '1px solid ' + (dragIdx === i ? 'var(--clay)' : 'var(--hair)'), opacity: dragIdx === i ? 0.5 : 1, cursor: canWrite ? 'pointer' : 'default' }}>
                {canWrite && <span title={t('Trascina per riordinare', 'Drag to reorder')} style={{ cursor: 'grab', color: 'var(--muted-2)', fontSize: 15, lineHeight: 1, letterSpacing: '-3px', flexShrink: 0, userSelect: 'none' }} onClick={(e) => e.stopPropagation()}>⋮⋮</span>}
                {cfg.hasColor && <span style={{ width: 14, height: 14, borderRadius: 99, background: c.color || 'var(--paper-2)', flexShrink: 0 }} />}
                <span style={{ flex: 1, fontWeight: 600, fontSize: 14.5 }}>{catName(c, kind, lang)}</span>
                {canWrite && (
                  <React.Fragment>
                    <MutationButton className="dk-iconbtn" style={{ width: 30, height: 30, borderRadius: 8 }} onClick={(e) => { e.stopPropagation(); setEdit({ ...c }); }}><Icon name="edit" size={14} /></MutationButton>
                    <MutationButton className="dk-iconbtn" style={{ width: 30, height: 30, borderRadius: 8 }} onClick={(e) => { e.stopPropagation(); del(c.id); }}><Icon name="x" size={14} color="var(--danger)" /></MutationButton>
                  </React.Fragment>
                )}
              </div>
            ))}
            {!list.length && <EmptyState icon="tag" title={t('Nessuna categoria', 'No categories')} sub={t('Crea la prima categoria.', 'Create the first category.')} />}
          </div>
        )}
      </div>

      {edit && <CatEditModal draft={edit} setDraft={setEdit} cfg={cfg} onSave={save} onDelete={del} onClose={() => setEdit(null)} t={t} />}
    </DkDrawer>
  );
}

function CatEditModalContent({ draft, setDraft, cfg, onSave, onDelete, onClose, t }) {
  const canSave = cfg.bilingual ? (draft.name_it || '').trim() : (draft.name || '').trim();
  return (
    <DkModal open onClose={onClose} title={draft._new ? t('Nuova categoria', 'New category') : t('Modifica categoria', 'Edit category')} width={440}
      foot={<React.Fragment>
        {!draft._new && <MutationButton className="dk-btn dk-btn--ghost" style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 40%, var(--hair))', marginRight: 'auto' }} onClick={() => onDelete(draft.id)}><Icon name="x" size={16} color="var(--danger)" />{t('Elimina', 'Delete')}</MutationButton>}
        <button className="dk-btn dk-btn--ghost" onClick={onClose}>{t('Annulla', 'Cancel')}</button>
        <MutationButton className="dk-btn dk-btn--clay" disabled={!canSave} onClick={() => canSave && onSave(draft)}><Icon name="check" size={17} color="#fff" />{t('Salva', 'Save')}</MutationButton>
      </React.Fragment>}>
      {cfg.bilingual ? (
        <React.Fragment>
          <div className="t-meta" style={{ marginBottom: 8 }}>{t('Nome (italiano)', 'Name (Italian)')}</div>
          <input value={draft.name_it || ''} onChange={(e) => setDraft((d) => ({ ...d, name_it: e.target.value }))} placeholder={t('Nome categoria', 'Category name')} autoFocus style={{ ...inputCss, width: '100%', boxSizing: 'border-box', fontSize: 15, padding: '11px 13px', marginBottom: 14 }} />
          <div className="t-meta" style={{ marginBottom: 8 }}>{t('Nome (inglese)', 'Name (English)')}</div>
          <input value={draft.name_en || ''} onChange={(e) => setDraft((d) => ({ ...d, name_en: e.target.value }))} placeholder={t('Facoltativo', 'Optional')} style={{ ...inputCss, width: '100%', boxSizing: 'border-box', fontSize: 15, padding: '11px 13px', marginBottom: 18 }} />
        </React.Fragment>
      ) : (
        <React.Fragment>
          <div className="t-meta" style={{ marginBottom: 8 }}>{t('Nome categoria', 'Category name')}</div>
          <input value={draft.name || ''} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder={t('Nome categoria', 'Category name')} autoFocus style={{ ...inputCss, width: '100%', boxSizing: 'border-box', fontSize: 15, padding: '11px 13px', marginBottom: 18 }} />
        </React.Fragment>
      )}

      {cfg.hasColor && (
        <React.Fragment>
          <div className="t-meta" style={{ marginBottom: 10 }}>{t('Colore', 'Colour')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <label title={t('Ruota dei colori', 'Colour wheel')} style={{ position: 'relative', width: 48, height: 48, borderRadius: 12, cursor: 'pointer', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--hair)', background: draft.color || '#888' }}>
              <input type="color" value={draft.color || '#888888'} onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value.toUpperCase() }))} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
            </label>
            <div style={{ flex: 1 }}>
              <div className="t-sm" style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>{t('Codice esadecimale', 'Hex code')}</div>
              <HexInput value={draft.color} onChange={(c) => setDraft((d) => ({ ...d, color: c }))} />
            </div>
          </div>
          <PaletteGrid value={draft.color} onChange={(c) => setDraft((d) => ({ ...d, color: c }))} />
        </React.Fragment>
      )}
    </DkModal>
  );
}

const CatEditModal = withPortalForm(CatEditModalContent, { preview: ({ draft }) => !!draft?.id });
