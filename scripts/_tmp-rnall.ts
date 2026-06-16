import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { db, schema } from '@/db/client';
import { eq } from 'drizzle-orm';
const STORE='04b6d06f-2747-4a86-9084-2cef7c2f88fa';
const PROFILES=[
  {id:'gid://shopify/DeliveryProfile/81761829046', lg:'gid://shopify/DeliveryLocationGroup/83153420470', name:'General'},
  {id:'gid://shopify/DeliveryProfile/92060942518', lg:'gid://shopify/DeliveryLocationGroup/92713746614', name:'MTO'},
];
let call:(q:string,v?:any)=>Promise<any>;
async function main(){
  const [s]=await db.select().from(schema.stores).where(eq(schema.stores.id,STORE)).limit(1);
  const token=await getStoreToken(STORE); call=(q,v)=>graphqlCall({shopDomain:s.shopDomain,apiVersion:s.apiVersion,token,query:q,variables:v});
  for(const P of PROFILES){
    let cursor:string|null=null,more=true;
    while(more){
      const q:any=await call(`query($id:ID!,$after:String){deliveryProfile(id:$id){profileLocationGroups{locationGroupZones(first:4,after:$after){pageInfo{hasNextPage endCursor} edges{node{zone{id name} methodDefinitions(first:80){edges{node{id name}}}}}}}}}`,{id:P.id,after:cursor});
      const conn=q.data?.deliveryProfile?.profileLocationGroups?.[0]?.locationGroupZones;
      for(const e of (conn?.edges??[])){
        const z=e.node;
        const std=z.methodDefinitions.edges.filter((x:any)=>/^standard shipping \(/i.test(x.node.name)).map((x:any)=>({id:x.node.id,name:'Standard shipping'}));
        if(!std.length) continue;
        let done=0;
        for(let i=0;i<std.length;i+=30){
          const m:any=await call(`mutation($id:ID!,$p:DeliveryProfileInput!){deliveryProfileUpdate(id:$id,profile:$p){userErrors{message}}}`,
            {id:P.id,p:{locationGroupsToUpdate:[{id:P.lg,zonesToUpdate:[{id:z.zone.id,methodDefinitionsToUpdate:std.slice(i,i+30)}]}]}});
          const er=m.data?.deliveryProfileUpdate?.userErrors; if(er?.length){console.log(`${P.name}/${z.zone.name} ERR`,JSON.stringify(er).slice(0,120));break;}
          done+=std.slice(i,i+30).length;
        }
        console.log(`${P.name}/${z.zone.name}: đổi tên ${done}`);
      }
      more=conn?.pageInfo?.hasNextPage;cursor=conn?.pageInfo?.endCursor;
    }
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error('ERR '+String(e).slice(0,300));process.exit(1);});
