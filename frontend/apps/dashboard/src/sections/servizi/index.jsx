// Servizi — services & packages catalog (ported from prototype DkServizi).
// Owns its own fetch/refetch of /api/catalog/services and /api/catalog/packages
// so edits show immediately; syncs the ctx base catalogs via reload.* after writes.
import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@youty/shared';
import { useDash } from '../../ctx.jsx';
import ServiziSub from './ServiziSub.jsx';
import PacchettiSub from './PacchettiSub.jsx';
import SvcEditModal from './SvcEditModal.jsx';
import PkgEditModal from './PkgEditModal.jsx';

export default function ServiziSection() {
  const {
    t, lang, subTab, setSubTab, serviceCategories, operators,
    reload, fireToast, hasScope, canMutate, openModal,
  } = useDash();

  const sub = subTab || 'servizi';
  const canPricing = hasScope('pricing'); // service/package writes
  const canTeam = hasScope('team');       // operator assignment writes

  /* ---- own data: services + packages (fresh, refetchable) ---- */
  const [services, setServices] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loadingSvc, setLoadingSvc] = useState(true);
  const [loadingPkg, setLoadingPkg] = useState(true);

  const toastErr = useCallback((err) => {
    if (err instanceof ApiError) fireToast({ msg: err.message, icon: 'alert' });
    else fireToast({ msg: t('Errore di rete', 'Network error'), icon: 'alert' });
  }, [fireToast, t]);

  const fetchServices = useCallback(async () => {
    const data = await api.get('/api/catalog/services');
    setServices(data);
  }, []);
  const fetchPackages = useCallback(async () => {
    const data = await api.get('/api/catalog/packages');
    setPackages(data);
  }, []);

  useEffect(() => {
    fetchServices().catch(toastErr).finally(() => setLoadingSvc(false));
    fetchPackages().catch(toastErr).finally(() => setLoadingPkg(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- modal state ---- */
  const [editSvc, setEditSvc] = useState(null); // service object | {} for new
  const [editPkg, setEditPkg] = useState(null); // package object | {} for new

  /* ---- service mutations ---- */

  /** operator assignment lives on the operator: PUT /api/staff/{id} with updated
   *  service_ids. Fetch fresh, diff against wanted set, send only the changed ones. */
  const syncOperators = useCallback(async (serviceId, wantedOpIds) => {
    const fresh = await api.get('/api/staff/');
    const changed = fresh.filter((o) => {
      const has = (o.service_ids || []).includes(serviceId);
      const want = wantedOpIds.includes(o.id);
      return has !== want;
    });
    if (!changed.length) return false;
    await Promise.all(changed.map((o) => {
      const want = wantedOpIds.includes(o.id);
      const ids = want
        ? [...(o.service_ids || []), serviceId]
        : (o.service_ids || []).filter((id) => id !== serviceId);
      return api.put(`/api/staff/${o.id}`, {
        first_name: o.first_name,
        last_name: o.last_name,
        color: o.color,
        role_title: o.role_title,
        location_id: o.location_id,
        user_id: o.user_id,
        service_ids: ids,
        hourly_cost: o.hourly_cost,
        cycle_weeks: o.cycle_weeks,
        active: o.active,
        order: o.order,
      });
    }));
    return true;
  }, []);

  const saveService = useCallback(async (payload, opIds) => {
    try {
      let saved;
      if (editSvc?.id) {
        saved = await api.put(`/api/catalog/services/${editSvc.id}`, payload);
      } else {
        saved = await api.post('/api/catalog/services', payload);
      }
      let opsChanged = false;
      if (canTeam) {
        try {
          opsChanged = await syncOperators(saved.id, opIds);
        } catch (err) {
          toastErr(err); // service saved, operator sync failed — report but don't lose the save
        }
      }
      setEditSvc(null);
      await fetchServices().catch(() => {});
      reload?.services?.().catch(() => {});
      if (opsChanged) reload?.operators?.().catch(() => {});
      fireToast({ msg: t('Servizio salvato', 'Service saved'), icon: 'check' });
    } catch (err) {
      toastErr(err);
    }
  }, [editSvc, canTeam, syncOperators, fetchServices, reload, fireToast, t, toastErr]);

  /** card toggle — DELETE = soft-deactivate, PUT(full payload) to reactivate */
  const toggleServiceActive = useCallback(async (s, active) => {
    setServices((l) => l.map((x) => (x.id === s.id ? { ...x, active } : x))); // optimistic
    try {
      if (!active) {
        await api.del(`/api/catalog/services/${s.id}`);
      } else {
        await api.put(`/api/catalog/services/${s.id}`, {
          category_id: s.category_id,
          name_it: s.name_it,
          name_en: s.name_en,
          duration_min: s.duration_min,
          price: s.price,
          product_cost: s.product_cost,
          supplier_cost: s.supplier_cost,
          active: true,
          order: s.order,
        });
      }
      reload?.services?.().catch(() => {});
      fireToast({
        msg: active ? t('Servizio riattivato', 'Service reactivated') : t('Servizio in pausa', 'Service paused'),
        icon: 'check',
      });
    } catch (err) {
      setServices((l) => l.map((x) => (x.id === s.id ? { ...x, active: !active } : x))); // roll back
      toastErr(err);
    }
  }, [reload, fireToast, t, toastErr]);

  /* ---- package mutations ---- */
  const savePackage = useCallback(async (payload) => {
    try {
      if (editPkg?.id) await api.put(`/api/catalog/packages/${editPkg.id}`, payload);
      else await api.post('/api/catalog/packages', payload);
      setEditPkg(null);
      await fetchPackages().catch(() => {});
      fireToast({ msg: t('Pacchetto salvato', 'Package saved'), icon: 'check' });
    } catch (err) {
      toastErr(err);
    }
  }, [editPkg, fetchPackages, fireToast, t, toastErr]);

  const deactivatePackage = useCallback(async () => {
    if (!editPkg?.id) return;
    try {
      await api.del(`/api/catalog/packages/${editPkg.id}`);
      setEditPkg(null);
      await fetchPackages().catch(() => {});
      fireToast({ msg: t('Pacchetto disattivato', 'Package deactivated'), icon: 'check' });
    } catch (err) {
      toastErr(err);
    }
  }, [editPkg, fetchPackages, fireToast, t, toastErr]);

  /* ---- categories manager (owned by Impostazioni) ---- */
  const openCats = useCallback(() => openModal('catsmgr', { kind: 'servizi' }), [openModal]);

  /* #2 — colore categoria configurabile dalla scheda servizio (resta un attributo della categoria) */
  const setCategoryColor = useCallback(async (catId, color) => {
    const cat = (serviceCategories || []).find((c) => c.id === catId);
    if (!cat) return;
    try {
      await api.put(`/api/catalog/categories/${catId}`, { name_it: cat.name_it, name_en: cat.name_en, color, order: cat.order });
      reload?.serviceCategories?.().catch(() => {});
      fireToast({ msg: t('Colore categoria aggiornato', 'Category colour updated'), icon: 'check' });
    } catch (err) { toastErr(err); }
  }, [serviceCategories, reload, fireToast, t, toastErr]);

  const tabs = [['servizi', t('Servizi', 'Services')], ['pacchetti', t('Pacchetti', 'Packages')]];

  return (
    <div className="dk-page" style={{ maxWidth: 1120 }}>
      {/* sub-tabs: Servizi / Pacchetti */}
      <div style={{ borderBottom: '1px solid var(--hair)', display: 'flex', gap: 4, marginBottom: 22 }}>
        {tabs.map(([k, l]) => (
          <button
            key={k} onClick={() => setSubTab(k)}
            style={{ padding: '11px 4px', marginRight: 22, fontSize: 15.5, fontWeight: 600, cursor: 'pointer', background: 'transparent', border: 'none', color: sub === k ? 'var(--ink)' : 'var(--muted)', borderBottom: '2px solid ' + (sub === k ? 'var(--clay)' : 'transparent'), marginBottom: -1 }}
          >
            {l}
          </button>
        ))}
      </div>

      {sub === 'servizi' ? (
        <ServiziSub
          services={services} loading={loadingSvc}
          categories={serviceCategories} operators={operators}
          canEdit={canPricing}
          onCats={openCats}
          onEdit={setEditSvc}
          onNew={() => setEditSvc({})}
          onToggleActive={toggleServiceActive}
          t={t} lang={lang}
        />
      ) : (
        <PacchettiSub
          packages={packages} loading={loadingPkg}
          services={services}
          canEdit={canPricing}
          onEdit={setEditPkg}
          onNew={() => setEditPkg({})}
          t={t} lang={lang}
        />
      )}

      {editSvc && (
        <SvcEditModal
          service={editSvc.id ? editSvc : null}
          categories={serviceCategories} operators={operators}
          canTeam={canTeam}
          canPricing={canPricing}
          onSave={saveService}
          onClose={() => setEditSvc(null)}
          onCats={openCats}
          onCatColor={setCategoryColor}
          t={t} lang={lang}
        />
      )}
      {editPkg && (
        <PkgEditModal
          pkg={editPkg.id ? editPkg : null}
          services={services}
          onSave={savePackage}
          onDelete={editPkg.id ? deactivatePackage : null}
          onClose={() => setEditPkg(null)}
          t={t} lang={lang}
        />
      )}
    </div>
  );
}
