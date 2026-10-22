// Paso: Terminaciones y control de calidad (implementación provisoria)
export default {
  id: 'terminaciones',
  title: 'Terminaciones y control de calidad',
  short: 'Terminaciones',
  icon: '🔍',
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
