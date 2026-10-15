import {Badge, Box, Button, Checkbox, Field, Group, Input, SearchInput, Spinner, Text} from '@optiaxiom/react';
import type {FxEvent} from '@shared/types';
import {useMemo, useState} from 'react';

import {errorMessage} from './api';

const EVENT_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Pick the rule's metrics from the project's custom events. Order matters: FX treats
 * the first metric as primary, so the selection keeps click order and lets the editor
 * promote one to the top.
 */
export function MetricPicker({
  events,
  selected,
  onChange,
  onCreateEvent,
}: {
  events: FxEvent[] | null;
  selected: number[];
  onChange: (ids: number[]) => void;
  onCreateEvent: (key: string, name: string) => Promise<FxEvent>;
}) {
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const byId = useMemo(() => new Map((events ?? []).map((e) => [e.id, e])), [events]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (events ?? []).filter((e) => !q || e.name.toLowerCase().includes(q) || e.key.toLowerCase().includes(q));
  }, [events, filter]);

  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  const makePrimary = (id: number) => onChange([id, ...selected.filter((s) => s !== id)]);

  const create = async () => {
    if (!EVENT_KEY_PATTERN.test(newKey)) {
      setCreateError('Key: letters, digits, _ . or - (max 64).');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const event = await onCreateEvent(newKey, newName || newKey);
      onChange([...selected, event.id]);
      setAdding(false);
      setNewKey('');
      setNewName('');
    } catch (error) {
      setCreateError(errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  if (!events) return <Spinner size="sm" />;

  return (
    <Group flexDirection="column" gap="8">
      {selected.length > 0 && (
        <Group flexDirection="column" gap="4">
          {selected.map((id, i) => (
            <Group alignItems="center" gap="4" key={id}>
              {i === 0 ? (
                <Badge intent="primary" variant="subtle">Primary</Badge>
              ) : (
                <Button appearance="subtle" onClick={() => makePrimary(id)} size="sm">Make primary</Button>
              )}
              <Text fontSize="sm" style={{flex: 1, minWidth: 0}} truncate>
                {byId.get(id)?.name ?? `Event ${id}`}
              </Text>
              <Button appearance="subtle" aria-label="Remove metric" onClick={() => toggle(id)} size="sm">✕</Button>
            </Group>
          ))}
        </Group>
      )}

      <SearchInput onChange={(e) => setFilter(e.target.value)} placeholder="Filter events…" value={filter} />
      <Box style={{maxHeight: 200, overflowY: 'auto'}}>
        <Group flexDirection="column" gap="4">
          {visible.map((e) => (
            <Checkbox
              checked={selected.includes(e.id)}
              description={e.key !== e.name ? e.key : undefined}
              key={e.id}
              onChange={() => toggle(e.id)}
              size="sm"
            >
              {e.name}
            </Checkbox>
          ))}
          {visible.length === 0 && <Text color="fg.secondary" fontSize="sm">No matching events.</Text>}
        </Group>
      </Box>

      {adding ? (
        <Group flexDirection="column" gap="8">
          <Field description="What the site passes to trackEvent()." label="Event key" required>
            <Input onChange={(e) => setNewKey(e.target.value.trim())} placeholder="mb_cta_click" value={newKey} />
          </Field>
          <Field label="Display name">
            <Input onChange={(e) => setNewName(e.target.value)} value={newName} />
          </Field>
          {createError && <Text color="fg.error" fontSize="sm">{createError}</Text>}
          <Group gap="8">
            <Button appearance="primary" loading={creating} onClick={() => void create()} size="sm">Create event</Button>
            <Button appearance="subtle" onClick={() => setAdding(false)} size="sm">Cancel</Button>
          </Group>
        </Group>
      ) : (
        <Button appearance="subtle" onClick={() => setAdding(true)} size="sm">+ New event</Button>
      )}
    </Group>
  );
}
