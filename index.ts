/**
 * Subject: Bachelor's thesis
 * Author: Pavel Podluzansky | xpodlu01@stud.fit.vutbr.cz
 * Year: 2021
 * Description:
 * 
 *      This file implements the server for the ntbshare extension.
 *      The main purpose of this server is to listen to events from
 *      sharer, handling shared file and sending the changes to 
 *      connected users.
 * 
 */

import { diff_match_patch, patch_obj } from "diff-match-patch";
import * as vscode from 'vscode';

export var dmp = new diff_match_patch();

interface itemsI{
  kind :number; index: number; text: string;output:RawCellOutput[]
}

interface RawCellOutput {
	mime: string;
	data: any;
}[]

var JSONFILE: { [rooms:string]: itemsI[]}={};

const PORT = process.env.PORT || 8000;
const io = require("socket.io")(PORT, {transports: ['websocket','polling']});

io.on("connection", function(socket:any){
  
    /**
     * 
     * If socket wants to join the room server sends
     * him back a boolean value if he can join that room
     * 
     */
    socket.on('join-room',function(roomName:string){
        let join: boolean = false
        if(socket.adapter.rooms.has(roomName))
        {
          join = true
        }
        socket.emit('get-room-list-join',join)
    })

    /**
    * 
    * socket listening on delete-room, if the event happened
    * the room has to be deleted
    * 
    **/   
    socket.on("delete-room",async (roomName:string)=>{
        delete JSONFILE[roomName]
        // inform clients that the sharing is over
        await io.to(roomName).emit('end')
        await io.of("/").adapter.on("delete-room", (roomName) => {
            console.log(`The room ${roomName} has been deleted `);
        });
    })

    /**
     * socket listening on create-room, if the event happened
     * the room has to be created and the true value 
     * will be sent back to the server. Or if the room already
     * exists the false value will be sent back to the sharer
     * 
     *  */  
    socket.on('create-room',function(roomName:string){
        let join: boolean = true
        if(socket.adapter.rooms.has(roomName))
        {
            join = false
        }
        socket.emit('get-room-list-create',join)
    })
    /*
    *
    *  range listening for changes in sharer visiblenotebookeditors,
    *  that means if sharer scrolling between them and he has them 
    *  more then the window can display
    * 
    */
    socket.on('range',function(rangeChange: vscode.NotebookRange[],roomName:string){
        io.to(roomName).emit('rangeChange',rangeChange,roomName)
    })
    /**
     * 
     *  After sharer select some text the selection will be sent to
     *  connected clients.
     * 
     */
    socket.on('selectionText',function(selections:number[][],index:number,roomName:string){
        io.to(roomName).emit('selection',selections,index,roomName)
    })
    /**
     *
     *  After user joined a room server send him complete file  
     *  
     */
    socket.on('join',function(roomName:string){
        socket.join(roomName)
        io.to(roomName).emit('get-file',JSONFILE[roomName])
    })

    /**
     * 
     * This function is called when user can be joined to
     * a server. The socket.join(roomName) adds the user
     * to the room 
     * 
     */
    socket.on('create',function(roomName:string){
        socket.join(roomName);
    })

    /**
     * 
     *  Patch listening for text changes in cells in sharer document.
     *  The changes needs to be applied to the JSONFILE and then send
     *  to other connected clients.
     * 
     */
    socket.on('patch', async function(data:{index: number;cellText: patch_obj[]},roomName:string){
        if(data.cellText.length!==0){
          let [text,result] = dmp.patch_apply(data.cellText,JSONFILE[roomName][data.index].text);
          if(text!== JSONFILE[roomName][data.index].text){
              JSONFILE[roomName][data.index].text=text;
              await io.to(roomName).emit('patch-client',data);
          }
        }
    });

    /**
     * 
     * The send_full_file event listening to complete file
     * this function is called when sharer starts to share 
     * a file. The server saves the data from sharer to JSON. 
     * 
     */
    socket.on('send_full_file',function(data: itemsI[],room:string){
        let file_changer: itemsI[] = [];
        data.forEach((value,index)=>{
            file_changer.push({kind:value.kind,index:value.index,text:value.text,output: value.output === undefined ? [] : value.output});
        })
        JSONFILE[room] = file_changer
    });
    
    /**
     * 
     *  whenever the output is created by sharer, the server listening for this change and
     *  adds the output to JSONFILE and send this output to other connected clients 
     * 
     */
      socket.on('Add-output',function(output:vscode.NotebookCellOutput[],index:number,roomName:string){ 
          JSONFILE[roomName].splice(index,1,{kind:JSONFILE[roomName][index].kind,index:JSONFILE[roomName][index].index,text:JSONFILE[roomName][index].text,output: output.length ===0 ? [] :output[0].items})
          io.to(roomName).emit('Output-add',output,index);
      })
    /**
     * 
     * server listening for move-cell event, whenever sharer make some move with cells,
     * this function is called. 
     * 
     */
    socket.on('move-cell', function(change:{'number':number,deletedCount:number,items:itemsI[]}[],roomName:string){ 
        JSONFILE[roomName].splice(change[0].number,change[0].deletedCount);
        JSONFILE[roomName].splice(change[0].items[0].index,0,{kind:change[0].items[0].kind,index:change[0].items[0].index,text:change[0].items[0].text,output:change[0].items[0].output})
        io.to(roomName).emit('Move-cell',change)
    });

    /**
     * 
     * whenever sharer add or delete some cell/s,
     * then this function is called. This function
     * needs to order the JSONFILE. The JSONFILE 
     * must have equal cells information after changes.
     * 
     */
    socket.on('Add-cell', function(change:{'number':number,deletedCount:number,items:itemsI[]}[],roomName:string){ 
        // adding cells
        if(change[0].deletedCount === 0)
        {
            for(let i=0;i< JSONFILE[roomName].length;i++)
            {
              if(JSONFILE[roomName][i].index >= change[0].number)
              {
                  JSONFILE[roomName][i].index = JSONFILE[roomName][i].index + 1;
              }
            }   
            for(let i=0;i<change[0].items.length;i++)
            {
                JSONFILE[roomName].splice(change[0].items[i].index,0,{kind:change[0].items[0].kind,index:JSONFILE[roomName].length,text:change[0].items[i].text,output:change[0].items[i].output})
            }
        }
          // deleting cells
        else if(change[0].deletedCount >= 1)
        {
            for(let i = 0;i < JSONFILE[roomName].length; i++)
            {
              if(JSONFILE[roomName][i].index >  JSONFILE[roomName][change[0].number].index)
              {
                  JSONFILE[roomName][i].index = JSONFILE[roomName][i].index-1  
              }
            }
              JSONFILE[roomName].splice(change[0].number,change[0].deletedCount);
        }
              io.to(roomName).emit('Update-cell',change)
      });

    /**
     *  
     * If socket disconnects then leave a room 
     * 
     */
    socket.on('disconnect',function(room:string){
        socket.leave(room)
    })
});
