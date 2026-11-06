import './contest-find.css';
import { installContestFind } from './contest-find';

const dispose = installContestFind();
if (import.meta.hot) import.meta.hot.dispose(dispose);
