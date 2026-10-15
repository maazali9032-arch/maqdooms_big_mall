import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {SessionContext} from '../workshop-inventory/session';
import {LocationDefinitions} from '@/features/inventory/LocationDefinitions';
import {ProductDesignDefinitions} from '@/features/tailoring/ProductDesignDefinitions';
import {Toaster} from 'sonner';
import '@/styles.css';
const params=new URLSearchParams(location.search),owner=!params.has('staff');
createRoot(document.getElementById('root')!).render(<SessionContext.Provider value={{isOwner:owner,roles:[owner?'owner':'counter'],permissions:[],userId:'fixture',fullName:'Fixture Owner',email:'owner@example.test',loading:false,can:()=>owner}}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><main className="mx-auto max-w-6xl p-3">{params.has('catalog')?<ProductDesignDefinitions/>:<LocationDefinitions/>}</main><Toaster/></QueryClientProvider></SessionContext.Provider>);
