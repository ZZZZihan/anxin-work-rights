import {pathToFileURL} from 'node:url';
const root=process.argv[2];
const modules=await Promise.all(['old','new'].map(tag=>import(pathToFileURL(`${root}/${tag}/lib/material-money-v4.ts`))));
for(const suffix of ['不到','不止','开外','不足','不满','未满','未达','不到三天付清','不足三天便付清','未满三个月已付清','不止一次催讨','，王乙工资不到三万元','。王乙工资不足三万元']) {
 const text='王甲工资四万元'+suffix, raw={kind:'money',value:'四万元',quote:text,blockId:'b1',subject:'王甲',scope:'individual',meaning:'arrears',completeness:'not_applicable',period:null,rateUnit:null,assertion:'narrated'};
 console.log(JSON.stringify({text,old:{full:modules[0].normalizeMoneyValueV4(text),crop:modules[0].normalizeCandidateValueV4(raw)},new:{full:modules[1].normalizeMoneyValueV4(text),crop:modules[1].normalizeCandidateValueV4(raw)}}));
}
