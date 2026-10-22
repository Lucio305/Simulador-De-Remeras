// Paso: Bienvenida (implementación provisoria)
export default {
  id: 'inicio',
  title: 'Bienvenida',
  short: 'Inicio',
  icon: '🏠',
  scored: false,
  help: '',
  defaults(state) {},
  async enter(ctx) {
    ctx.placeShirt('exhibicion');
    ctx.flyTo(ctx.stations.exhibicion.view);
    ctx.ui.panel({
      kicker: 'Paso',
      title: this.title,
      subtitle: 'En construcción.',
      actions: [{ id: 'next', label: 'Continuar →', kind: 'primary', onClick: () => ctx.next() }],
    });
  },
};
