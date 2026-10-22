// Paso: Hilo y aguja (implementación provisoria)
export default {
  id: 'hilo',
  title: 'Hilo y aguja',
  short: 'Hilo',
  icon: '🧵',
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
