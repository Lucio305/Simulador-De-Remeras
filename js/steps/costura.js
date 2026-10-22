// Paso: Coser a máquina (implementación provisoria)
export default {
  id: 'costura',
  title: 'Coser a máquina',
  short: 'Costura',
  icon: '🪡',
  scored: true,
  help: '',
  defaults(state) {},
  async enter(ctx) {
    ctx.placeShirt('exhibicion');
    ctx.flyTo(ctx.stations.exhibicion.view);
    ctx.ui.panel({
      kicker: 'Paso',
      title: this.title,
      subtitle: 'En construcción.',
      actions: [{ id: 'next', label: 'Continuar →', kind: 'primary', onClick: () => ctx.complete({ score: 75, notes: [] }) }],
    });
  },
};
