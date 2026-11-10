import {Box, Checkbox, Group, SearchInput, Spinner, Text} from '@optiaxiom/react';
import type {AudienceOption} from '@shared/types';
import {useMemo, useState} from 'react';

/** Audiences by name. None ticked means every visitor. */
export function AudiencePicker({
  audiences,
  selected,
  onChange,
}: {
  audiences: AudienceOption[] | null;
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [filter, setFilter] = useState('');
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (audiences ?? []).filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [audiences, filter]);

  if (!audiences) return <Spinner size="sm" />;
  if (audiences.length === 0) {
    return (
      <Text color="fg.secondary" fontSize="sm">
        {selected.length > 0 ? `Audience IDs ${selected.join(', ')} (from app settings).` : 'Every visitor.'} Add the
        site&apos;s SDK key in the app settings to pick audiences by name.
      </Text>
    );
  }

  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  // An id that isn't in the project anymore stays visible so it can be unticked.
  const unknown = selected.filter((id) => !audiences.some((a) => a.id === id));

  return (
    <Group flexDirection="column" gap="8">
      <Text color="fg.secondary" fontSize="xs">
        {selected.length === 0 ? 'Every visitor can enter.' : 'Visitors in any ticked audience can enter.'}
      </Text>
      {audiences.length > 8 && (
        <SearchInput onChange={(e) => setFilter(e.target.value)} placeholder="Filter audiences…" value={filter} />
      )}
      <Box style={{maxHeight: 180, overflowY: 'auto'}}>
        <Group flexDirection="column" gap="4">
          {visible.map((a) => (
            <Checkbox checked={selected.includes(a.id)} key={a.id} onChange={() => toggle(a.id)} size="sm">
              {a.name}
            </Checkbox>
          ))}
          {unknown.map((id) => (
            <Checkbox checked description="Not in this project" key={id} onChange={() => toggle(id)} size="sm">
              Audience {id}
            </Checkbox>
          ))}
        </Group>
      </Box>
    </Group>
  );
}
