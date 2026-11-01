const numberOr = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const text = (value) => typeof value === 'string' ? value.trim() : ''

export function buildCocVehicleView(actor) {
  const system = actor?.system ?? {}
  const stats = system.stats ?? {}
  const hp = stats.hp ?? {}
  const hpMax = numberOr(hp.max)
  const hpValue = numberOr(hp.value)
  const crew = text(system.crew?.total)
  return {
    header: {
      name: text(actor?.name),
      img: text(actor?.img),
      hp: { show: stats.hp !== null && stats.hp !== undefined, value: hpValue, max: hpMax, percent: hpMax > 0 ? Math.round(hpValue / hpMax * 100) : 0 },
      mp: { show: false },
      san: { show: false },
      stats: [],
      derived: {
        db: '—',
        build: numberOr(stats.build?.value),
        mov: numberOr(stats.mov),
        armour: numberOr(stats.armor?.value),
      },
      badges: [],
    },
    attacks: [],
    skills: { total: 0, common: [], remaining: [], moreCount: 0 },
    powers: crew ? [{
      id: 'crew', name: '乘员与机组', img: '', type: 'vehicle', typeLabel: '载具',
      description: crew, total: null, rollable: false, rollLabel: '—', meta: [],
    }] : [],
    equipment: { armours: [], gears: [], count: 0 },
    note: text(system.description?.value),
  }
}
