import React, { useEffect, useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LangProvider } from './i18n.jsx';
import { PortalAccessContext, PortalAccessPanel, PortalFormGate, MutationButton, MutationNumInput, MutationInput } from './portalAccess.jsx';
import DkModal from '../../../apps/dashboard/src/ui/DkModal.jsx';

const active = () => ({ operational_access: true, status: 'active', checked_at: new Date().toISOString(), valid_until: new Date(Date.now() + 60000).toISOString() });
const required = { operational_access: false, status: 'subscription_required', purchase_url: 'https://platform.example/plans/configure' };
const unavailable = { ...required, status: 'unavailable' };
const wrap = (access, child, lang = 'en') => <LangProvider initial={lang}><PortalAccessContext.Provider value={access}>{child}</PortalAccessContext.Provider></LangProvider>;
const event = () => ({ prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });

test('locked entry stays clickable, explains access, and never invokes the mutation', () => {
  let requests = 0, writes = 0;
  const root = TestRenderer.create(wrap({ ...required, requestAccess: () => requests++ }, <MutationButton onClick={() => writes++}>New booking</MutationButton>));
  const button = root.root.findByType('button');
  assert.equal(!!button.props.disabled, false);
  assert.equal(button.props['aria-disabled'], undefined);
  assert.equal(button.props['aria-haspopup'], 'dialog');
  assert.equal(button.props['data-portal-locked'], true);
  const click = event();
  act(() => button.props.onClick(click));
  assert.equal(requests, 1); assert.equal(writes, 0); assert.ok(click.prevented && click.stopped);
  act(() => root.update(wrap(active(), <MutationButton disabled onClick={() => writes++}>New booking</MutationButton>)));
  assert.equal(root.root.findByType('button').props.disabled, true, 'subscription cannot remove a role/validation lock');
});

test('verified unpaid panel offers purchase, unavailable panel offers retry without purchase copy', () => {
  let retries = 0;
  const root = TestRenderer.create(wrap(required, <PortalAccessPanel />));
  assert.equal(root.root.findByType('a').props.href, required.purchase_url);
  act(() => root.update(wrap({ ...unavailable, refresh: () => retries++ }, <PortalAccessPanel />)));
  assert.equal(root.root.findAllByType('a').length, 0);
  assert.match(JSON.stringify(root.toJSON()), /cannot verify your subscription/);
  act(() => root.root.findByType('button').props.onClick());
  assert.equal(retries, 1);
});

test('direct entry gates before mounting, then freezes and restores the exact mounted draft', () => {
  let mounts = 0, unmounts = 0;
  function Draft() {
    const [value, setValue] = useState('');
    useEffect(() => { mounts++; return () => unmounts++; }, []);
    return <input aria-label="Draft name" value={value} onChange={(e) => setValue(e.target.value)} />;
  }
  const child = <PortalFormGate><Draft /></PortalFormGate>;
  const root = TestRenderer.create(wrap(required, child));
  assert.equal(mounts, 0); assert.equal(root.root.findAllByType('input').length, 0);
  act(() => root.update(wrap(active(), child)));
  const instance = root.root.findByType(Draft);
  act(() => root.root.findByType('input').props.onChange({ target: { value: 'Appointment draft' } }));
  for (const decision of [required, unavailable, active()]) {
    act(() => root.update(wrap(decision, child)));
    assert.equal(root.root.findByType(Draft), instance);
    assert.equal(root.root.findByType('input').props.value, 'Appointment draft');
    assert.equal(root.root.findByType('fieldset').props.disabled, !decision.operational_access);
  }
  assert.equal(mounts, 1); assert.equal(unmounts, 0);
});

test('existing record preview stays selectable while independent filters and navigation remain enabled', () => {
  let selected = 0;
  const root = TestRenderer.create(wrap(required, <>
    <input aria-label="Search" /><button onClick={() => selected++}>Existing records</button>
    <PortalFormGate preview><input value="Stored location" readOnly /></PortalFormGate>
  </>));
  assert.equal(root.root.findAllByType('input')[0].props.disabled, undefined);
  const nav = root.root.findAllByType('button').find((b) => b.children.includes('Existing records'));
  act(() => nav.props.onClick()); assert.equal(selected, 1);
  assert.equal(root.root.findByType('fieldset').props.disabled, true);
  assert.equal(root.root.findAllByType('input')[1].props.value, 'Stored location');
});

test('framed draft freezes body and save while modal close and footer cancel stay enabled', () => {
  let closes = 0;
  const child = <PortalFormGate framed><DkModal open onClose={() => closes++} title="Draft" foot={<><button onClick={() => closes++}>Cancel</button><MutationButton>Save</MutationButton></>}><input value="Preserved" readOnly /></DkModal></PortalFormGate>;
  const root = TestRenderer.create(wrap(active(), child));
  act(() => root.update(wrap(unavailable, child)));
  assert.equal(root.root.findAllByType('fieldset').length, 1);
  assert.ok(root.root.findAllByType('fieldset').every((f) => f.props.disabled));
  const close = root.root.findAllByType('button').find((b) => b.props.className === 'dk-iconbtn');
  assert.equal(close.props.disabled, undefined);
  act(() => close.props.onClick()); assert.equal(closes, 1);
  const cancel = root.root.findAllByType('button').find((b) => b.children.includes('Cancel'));
  for (let node = cancel; node; node = node.parent) assert.ok(node.type !== 'fieldset' || !node.props.disabled);
  act(() => cancel.props.onClick()); assert.equal(closes, 2);
  const save = root.root.findAllByType('button').find((b) => b.children.includes('Save'));
  assert.equal(save.props.disabled, true);
  assert.equal(root.root.findByType('input').props.value, 'Preserved');
});

test('organization switch remounts draft owner above the gate while same-org revocation preserves it', () => {
  function Owner() {
    const [value, setValue] = useState('');
    return <PortalFormGate><input value={value} onChange={(e) => setValue(e.target.value)} /></PortalFormGate>;
  }
  const root = TestRenderer.create(wrap(active(), <Owner key="salon-a" />));
  act(() => root.root.findByType('input').props.onChange({ target: { value: 'Private draft A' } }));
  act(() => root.update(wrap(required, <Owner key="salon-a" />)));
  assert.equal(root.root.findByType('input').props.value, 'Private draft A');
  act(() => root.update(wrap(required, <Owner key="salon-b" />)));
  assert.equal(root.root.findAllByType('input').length, 0);
  act(() => root.update(wrap(active(), <Owner key="salon-b" />)));
  assert.equal(root.root.findByType('input').props.value, '');
});

test('public panel remains neutral and never exposes subscription or purchase details', () => {
  const root = TestRenderer.create(wrap({ ...required, publicAccess: true }, <PortalAccessPanel />));
  const content = JSON.stringify(root.toJSON());
  assert.match(content, /contact the salon/); assert.doesNotMatch(content, /Activate your|Manage subscription/);
  assert.equal(root.root.findAllByType('a').length, 0);
});

test('known expired decision and late numeric blur cannot mutate', () => {
  let writes = 0;
  const expired = { ...active(), valid_until: new Date(Date.now() - 1).toISOString() };
  const root = TestRenderer.create(wrap(expired, <MutationNumInput value={5} onChange={() => writes++} />));
  const input = root.root.findByType('input');
  assert.equal(input.props.readOnly, true);
  assert.equal(!!input.props.disabled, false);
  act(() => input.props.onBlur({})); assert.equal(writes, 0);
});


test('late input blur and keyboard callbacks cannot cause business side effects after revocation', () => {
  let effects = 0;
  const field = <MutationInput onBlur={() => effects++} onKeyDown={() => effects++} onChange={() => effects++} />;
  const root = TestRenderer.create(wrap(active(), field));
  act(() => root.update(wrap(unavailable, field)));
  const input = root.root.findByType('input');
  act(() => { input.props.onBlur({}); input.props.onKeyDown({ key: 'Enter' }); input.props.onChange({ target: { value: 'late' } }); });
  assert.equal(effects, 0);
});


test('inline text stays selectable/read-only while file inputs and explicit role locks stay disabled', () => {
  const root = TestRenderer.create(wrap(required, <><MutationInput value="Stored address" /><MutationInput type="file" /><MutationInput value="Role locked" disabled /></>));
  const [text, file, role] = root.root.findAllByType('input');
  assert.equal(text.props.readOnly, true); assert.equal(!!text.props.disabled, false);
  assert.equal(file.props.disabled, true); assert.equal(role.props.disabled, true);
});
