import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { COUNTRIES, PRIORITY_COUNTRIES, foldCountry, searchCountries } from '../../content/countries'

/**
 * A searchable country picker: type to filter, arrow keys or tap to choose.
 *
 * WHY NOT A NATIVE <select>. Two hundred and fifty options in a phone's wheel
 * picker is a long scroll for anyone not from "A". Typing "ne" and tapping
 * Netherlands is faster, and this still behaves like a select: the value is
 * always either empty or exactly one of COUNTRIES, never free text. Whatever is
 * typed but not chosen is discarded on blur.
 *
 * Follows the ARIA combobox pattern (input owns a listbox, aria-activedescendant
 * tracks the highlighted option) so it works from a keyboard and a screen reader.
 */
export default function CountrySelect({
  id,
  value,
  onChange,
  invalid = false,
  inputClassName,
  placeholder = 'Start typing your country',
}: {
  id: string
  /** '' or one of COUNTRIES. */
  value: string
  onChange: (country: string) => void
  invalid?: boolean
  /** The host form's own input styling, so this matches its neighbours. */
  inputClassName: string
  placeholder?: string
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  /** What is in the box while the list is open. Closed, the box shows `value`. */
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const options = useMemo(() => searchCountries(query), [query])
  const showDivider = query.trim() === ''

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const openList = () => {
    setQuery('')
    setActive(Math.max(0, value ? COUNTRIES.indexOf(value) : 0))
    setOpen(true)
  }

  const choose = (country: string) => {
    onChange(country)
    setOpen(false)
    setQuery('')
  }

  const close = () => {
    // Typing an exact name and tabbing away counts as choosing it. Anything
    // else typed is dropped: the field holds a country or nothing.
    const exact = COUNTRIES.find((name) => foldCountry(name) === foldCountry(query))
    if (open && exact) onChange(exact)
    setOpen(false)
    setQuery('')
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) close()
      }}
    >
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        // The browser's own country autofill would write a value this component
        // never sees as a choice.
        name="country-search"
        placeholder={placeholder}
        value={open ? query : value}
        onFocus={openList}
        onClick={() => !open && openList()}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) openList()
            else setActive((i) => Math.min(options.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') {
            if (open && options[active]) {
              e.preventDefault()
              choose(options[active])
            }
          } else if (e.key === 'Escape') {
            if (open) {
              e.preventDefault()
              setOpen(false)
              setQuery('')
            }
          }
        }}
        className={inputClassName}
      />

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          // Lenis smooth-scrolls the page; without this the wheel would scroll
          // the page behind the list instead of the list.
          data-lenis-prevent
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-cw-navy/15 bg-white py-1 text-[15px] shadow-[0_12px_32px_rgba(2,48,71,0.16)]"
        >
          {options.length === 0 ? (
            <li className="px-4 py-2.5 text-cw-ink/60">No country matches that.</li>
          ) : (
            options.map((name, i) => (
              <li
                key={name}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={name === value}
                // mousedown, not click: click fires after the input's blur has
                // already closed the list.
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(name)
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-4 py-2.5 ${
                  i === active ? 'bg-cw-teal-soft text-cw-navy' : 'text-cw-ink'
                } ${name === value ? 'font-semibold' : ''} ${
                  showDivider && i === PRIORITY_COUNTRIES.length - 1
                    ? 'border-b border-cw-navy/10'
                    : ''
                }`}
              >
                {name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
