import { app } from './app';
import { config } from './config/env';

const { port } = config.app;

app.listen(port, () => {
  console.log(`Backend running on port ${port}`);
});
